"use client";

import Link from "next/link";
import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ARCHITECTURE_PROVIDERS, ARCHITECTURE_TYPES, architectureProviderLabel, architectureTypeLabel, connectionRuleError, inferArchitectureType, type ArchitectureNode, type ArchitectureState, type ArchitectureType, type ArchitectureZone } from "../../lib/architecture";
import { validateArchitecture } from "../../lib/architecture-validator";
import { applyInterviewTurn, applyObservationTurn, createInterviewState, interviewPhases, type InterviewState, type InterviewTurn } from "../../lib/interview";
import type { EvaluationReport } from "../../lib/evaluation";
import { scenarios } from "../../lib/scenarios";
import { scenarioBriefFor, starterArchitectureFor } from "../../lib/prebuilt-architectures";
import { saveLocalHistoryItem, snapshotKeyFor } from "../../lib/local-history";
import { architecturePNGDataURL, buildTranscriptDoc } from "../../lib/transcript";
import type { WhisperRequest, WhisperResponse } from "./whisper.worker";

/**
 * Every interview is isolated. A "run" token scopes the live browser snapshot,
 * so a new interview always loads its scenario's prebuilt canvas and never
 * inherits a design from an earlier session. The snapshot only exists so a
 * refresh of the same interview (same ?run=) doesn't lose work.
 */
type LiveSnapshot = {
  scenario: string;
  difficulty: InterviewState["difficulty"];
  architecture: ArchitectureState;
  state: InterviewState;
  startedAt?: number;
  savedAt: number;
};

const newRunToken = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : `run-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const MAX_LIVE_SNAPSHOTS = 12;

const writeSnapshot = (run: string, snapshot: Omit<LiveSnapshot, "savedAt">) => {
  try {
    window.localStorage.setItem(snapshotKeyFor(run), JSON.stringify({ ...snapshot, savedAt: Date.now() }));
    // The interview history lives in the browser, so keep storage tidy by
    // pruning the oldest run snapshots once the cap is reached.
    const prefix = "blueprint-live-";
    const entries: Array<{ run: string; savedAt: number }> = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix) || key === snapshotKeyFor(run)) continue;
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || "{}") as LiveSnapshot;
        entries.push({ run: key.slice(prefix.length), savedAt: parsed.savedAt || 0 });
      } catch {
        entries.push({ run: key.slice(prefix.length), savedAt: 0 });
      }
    }
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (const entry of entries.slice(MAX_LIVE_SNAPSHOTS - 1)) {
      window.localStorage.removeItem(snapshotKeyFor(entry.run));
    }
  } catch {
    // Storage unavailable — the interview still works live; only refresh-resume is lost.
  }
};

const readSnapshot = (run: string): LiveSnapshot | null => {
  try {
    const raw = window.localStorage.getItem(snapshotKeyFor(run));
    return raw ? (JSON.parse(raw) as LiveSnapshot) : null;
  } catch {
    return null;
  }
};

// The canvas paints a fixed-size "world" that is panned and zoomed as a whole,
// so designs can grow past a single screen. Node x/y stay 0-100 percentages of
// this world, which keeps older saved architectures working unchanged.
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1500;
const NODE_WIDTH = 145;
const PORTS_PER_SIDE = 3;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;

// A hard ceiling on interview length. When it is reached the interview ends
// itself, produces the architecture diagram and closing critique, and opens
// the scorecard — no candidate can monopolise a session indefinitely.
const INTERVIEW_MAX_MS = 40 * 60 * 1000;
const INTERVIEW_WARN_MS = 5 * 60 * 1000;

/** mm:ss remaining, floored at zero. */
const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

// Availability-zone boxes are stored as top-left corner plus size, all as
// percentages of the same world, so they pan and zoom with the nodes.
const MIN_ZONE_WIDTH = 14;
const MIN_ZONE_HEIGHT = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const pointInZone = (node: { x: number; y: number }, zone: ArchitectureZone) =>
  node.x >= zone.x && node.x <= zone.x + zone.width && node.y >= zone.y && node.y <= zone.y + zone.height;

/** The topmost (last-drawn) zone whose rectangle contains a node's center. */
const zoneContaining = (node: { x: number; y: number }, zones: ArchitectureZone[] | undefined) => {
  if (!zones || zones.length === 0) return undefined;
  for (let index = zones.length - 1; index >= 0; index -= 1) {
    if (pointInZone(node, zones[index])) return zones[index];
  }
  return undefined;
};

/** Re-tag nodes with the zone their center currently sits inside. */
const assignZones = (nodes: ArchitectureNode[], zones: ArchitectureZone[] | undefined) =>
  nodes.map((node) => {
    const zone = zoneContaining(node, zones);
    if ((node.zone || undefined) === (zone?.id || undefined)) return node;
    return { ...node, zone: zone?.id };
  });

/** A short "×3 replicas · 4 shards" badge, or an empty string when neither is set. */
const nodeTopologyLabel = (node: ArchitectureNode) => {
  const parts: string[] = [];
  if ((node.replicas || 0) > 1) parts.push(`×${node.replicas} replicas`);
  else if (node.replicas === 1) parts.push("1 replica");
  if ((node.shards || 0) > 1) parts.push(`${node.shards} shards`);
  else if (node.shards === 1) parts.push("1 shard");
  return parts.join(" · ");
};

const parseHandle = (handle: string | undefined, fallback: "left" | "right"): ["left" | "right", number] => {
  if (handle) {
    const [side, index] = handle.split("-");
    if ((side === "left" || side === "right") && index !== undefined) return [side, Number(index) || 0];
  }
  return [fallback, Math.floor((PORTS_PER_SIDE - 1) / 2)];
};

const portWorldPosition = (node: ArchitectureNode, side: "left" | "right", index: number) => {
  const cx = (node.x / 100) * WORLD_WIDTH;
  const cy = (node.y / 100) * WORLD_HEIGHT;
  const gap = 20;
  const offset = (index - (PORTS_PER_SIDE - 1) / 2) * gap;
  return { x: side === "left" ? cx - NODE_WIDTH / 2 : cx + NODE_WIDTH / 2, y: cy + offset };
};

function normalizeArchitecture(value: ArchitectureState): ArchitectureState {
  const nodeIds = new Set<string>();
  const nodes = value.nodes.map((node, index) => {
    const baseId = node.id || `node-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (nodeIds.has(id)) id = `${baseId}-${suffix++}`;
    nodeIds.add(id);
    return { ...node, id };
  });
  const nodeIdSet = new Set(nodes.map((node) => node.id));
  const nodeIdMap = new Map(value.nodes.map((node, index) => [node.id, nodes[index]?.id || node.id]));
  const edgeIds = new Set<string>();
  const edges = value.edges.flatMap((edge, index) => {
    const source = nodeIdMap.get(edge.source);
    const target = nodeIdMap.get(edge.target);
    if (!source || !target || !nodeIdSet.has(source) || !nodeIdSet.has(target)) return [];
    const baseId = edge.id || `edge-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (edgeIds.has(id)) id = `${baseId}-${suffix++}`;
    edgeIds.add(id);
    return [{ ...edge, id, source, target }];
  });
  const zones = (value.zones || []).map((zone, index) => ({ ...zone, id: zone.id || `zone-${index + 1}` }));
  return zones.length ? { nodes, edges, zones } : { nodes, edges };
}

export default function InterviewPage() {
  const [architecture, setArchitecture] = useState<ArchitectureState>(() => starterArchitectureFor("youtube"));
  const [selected, setSelected] = useState("client-1");
  const [interviewState, setInterviewState] = useState<InterviewState>(() => {
    const starter = starterArchitectureFor("youtube");
    const brief = scenarioBriefFor("youtube");
    return createInterviewState("Design YouTube", "hard", starter, { opening: brief.opening, description: brief.description });
  });
  const [question, setQuestion] = useState("");
  const [scenarioName, setScenarioName] = useState("Design YouTube");
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [addServiceOpen, setAddServiceOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceType, setNewServiceType] = useState<ArchitectureType | "auto">("auto");
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [connectPointer, setConnectPointer] = useState<{ x: number; y: number } | null>(null);
  const [connectionStart, setConnectionStart] = useState<{ fromNode: string; fromSide: "left" | "right"; fromIndex: number } | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [runToken, setRunToken] = useState("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [micPermission, setMicPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSubmittingTurn, setIsSubmittingTurn] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [micStatus, setMicStatus] = useState("");
  const [whisperModelState, setWhisperModelState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [activeComponentId, setActiveComponentId] = useState<string | null>(null);
  const [componentQuestion, setComponentQuestion] = useState("");
  const [showEditTools, setShowEditTools] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [interviewEnded, setInterviewEnded] = useState(false);
  const [showScorecard, setShowScorecard] = useState(false);
  const [componentDraft, setComponentDraft] = useState("");
  const [componentSubmitting, setComponentSubmitting] = useState(false);
  const [evaluationReport, setEvaluationReport] = useState<EvaluationReport | null>(null);
  const [evaluationDiagram, setEvaluationDiagram] = useState("");
  const [interviewStartedAt, setInterviewStartedAt] = useState(0);
  const [remainingMs, setRemainingMs] = useState(INTERVIEW_MAX_MS);
  const [timeLimitReached, setTimeLimitReached] = useState(false);
  const interviewStartedAtRef = useRef(0);
  const nextId = useRef(0);
  const nextEdgeId = useRef(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startPointerX: number; startPointerY: number; startNodeX: number; startNodeY: number; moved: boolean } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number; x: number; y: number; cx: number; cy: number } | null>(null);
  const connectionErrorTimerRef = useRef<number | null>(null);
  const zoneDragRef = useRef<{ id: string; startPointerX: number; startPointerY: number; startX: number; startY: number; members: { id: string; x: number; y: number }[] } | null>(null);
  const zoneResizeRef = useRef<{ id: string; startPointerX: number; startPointerY: number; startWidth: number; startHeight: number } | null>(null);
  // On-device Whisper worker. It is created when the page mounts (see the
  // preload effect below) so the model can download in the background and the
  // first recording transcribes with almost no wait.
  const whisperWorkerRef = useRef<Worker | null>(null);
  const whisperPendingRef = useRef<{ id: number; resolve: (text: string) => void; reject: (error: Error) => void } | null>(null);
  const whisperRequestIdRef = useRef(0);
  // Live voice capture: 16 kHz PCM accumulates on a ScriptProcessor and is
  // transcribed in rolling windows so captions appear while the user speaks.
  const liveStreamRef = useRef<MediaStream | null>(null);
  const liveContextRef = useRef<AudioContext | null>(null);
  const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const liveProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const liveSamplesRef = useRef<Float32Array | null>(null);
  const liveTimerRef = useRef<number | null>(null);
  const liveTranscribingRef = useRef(false);
  const listeningRef = useRef(false);
  const submittingTurnRef = useRef(false);

  // Create (once) the Whisper worker and dispatch its messages. The worker is
  // warmed up in the background as soon as the page mounts; if creation ever
  // fails, voice input reports the error through mic status instead of
  // crashing the interview.
  const getWhisperWorker = (): Worker => {
    let worker = whisperWorkerRef.current;
    if (!worker) {
      worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WhisperResponse>) => {
        const message = event.data;
        if (message.action === "loading") {
          setWhisperModelState("loading");
          return;
        }
        if (message.action === "ready") {
          setWhisperModelState("ready");
          return;
        }
        if (message.action === "ready-failed") {
          setWhisperModelState("failed");
          return;
        }
        // Transcribe result — matched against the single in-flight request.
        const pending = whisperPendingRef.current;
        if (!pending || pending.id !== message.id) return;
        whisperPendingRef.current = null;
        if (message.ok) pending.resolve(message.text);
        else pending.reject(new Error(message.error || "Voice transcription failed."));
      };
      worker.onerror = (event) => {
        const pending = whisperPendingRef.current;
        whisperPendingRef.current = null;
        pending?.reject(new Error(event.message || "The speech model could not be loaded."));
        setWhisperModelState("failed");
      };
      whisperWorkerRef.current = worker;
    }
    return worker;
  };

  useEffect(() => () => {
    if (liveTimerRef.current) window.clearInterval(liveTimerRef.current);
    liveTimerRef.current = null;
    try { liveProcessorRef.current?.disconnect(); } catch { /* already stopped */ }
    try { liveSourceRef.current?.disconnect(); } catch { /* already stopped */ }
    try { void liveContextRef.current?.close(); } catch { /* already stopped */ }
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    whisperWorkerRef.current?.terminate();
    whisperWorkerRef.current = null;
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    void navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
      if (!cancelled) setMicPermission("granted");
    }).catch(() => {
      if (!cancelled) setMicPermission("denied");
    });
    return () => { cancelled = true; };
  }, []);

  // Warm up the on-device speech model in the background: the worker downloads
  // it once (cached by the browser) and reports `loading` then `ready`, so a
  // recording made a few seconds after page load transcribes with almost no
  // wait. Failure here is fine — recording still works and transcription
  // reports any real error. State changes happen in worker message callbacks
  // (an external system), not synchronously inside the effect.
  useEffect(() => {
    if (typeof window === "undefined" || !("Worker" in window)) return;
    try {
      getWhisperWorker().postMessage({ action: "preload" } satisfies WhisperRequest);
    } catch {
      // Worker creation failed; any real error surfaces if the user records.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const scenarioParam = params.get("scenario");
      const difficultyParam = params.get("difficulty");
      const runParam = params.get("run");
      // Resolve the scenario by slug (links from scenario cards) or by display
      // name (the dropdown / custom flows), then canonicalize the URL to the slug.
      const bySlug = scenarios.find((item) => item.slug === scenarioParam);
      const catalogScenario = bySlug || scenarios.find((item) => item.name.toLowerCase() === (scenarioParam || "").trim().toLowerCase());
      const displayScenario = catalogScenario?.name || scenarioParam || "Design YouTube";
      const selectedDifficulty: InterviewState["difficulty"] = difficultyParam === "easy" || difficultyParam === "medium" || difficultyParam === "hard" || difficultyParam === "expert" ? difficultyParam : catalogScenario?.difficulty || "medium";

      // A run token may only restore the exact interview that created it — a
      // different interview never inherits another session's canvas.
      if (runParam) {
        const snapshot = readSnapshot(runParam);
        if (snapshot && Array.isArray(snapshot.architecture?.nodes) && snapshot.state && Array.isArray(snapshot.state.answers)) {
          const normalized = normalizeArchitecture(snapshot.architecture);
          const restoredStartedAt = typeof snapshot.startedAt === "number" && snapshot.startedAt > 0 ? snapshot.startedAt : Date.now();
          setRunToken(runParam);
          setScenarioName(snapshot.scenario);
          setArchitecture(normalized);
          setInterviewState(snapshot.state);
          setQuestion(snapshot.state.currentQuestionData?.text || snapshot.state.currentQuestion);
          interviewStartedAtRef.current = restoredStartedAt;
          setInterviewStartedAt(restoredStartedAt);
          return;
        }
      }

      // Fresh interview: every scenario starts from its own prebuilt canvas —
      // a single client node — and the interviewer opens with the scenario's
      // own briefing instead of generic text.
      const freshRun = newRunToken();
      const startedAt = Date.now();
      interviewStartedAtRef.current = startedAt;
      setInterviewStartedAt(startedAt);
      const starter = starterArchitectureFor(catalogScenario?.slug || scenarioParam || displayScenario);
      const brief = scenarioBriefFor(catalogScenario?.slug || scenarioParam || displayScenario);
      const freshState = createInterviewState(displayScenario, selectedDifficulty, starter, { opening: brief.opening, description: brief.description });
      setRunToken(freshRun);
      setScenarioName(displayScenario);
      setArchitecture(starter);
      setInterviewState(freshState);
      setQuestion(freshState.currentQuestion);
      writeSnapshot(freshRun, { scenario: displayScenario, difficulty: selectedDifficulty, architecture: starter, state: freshState, startedAt });
      const url = new URL(window.location.href);
      url.searchParams.set("scenario", catalogScenario?.slug || scenarioParam || displayScenario.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
      url.searchParams.set("difficulty", selectedDifficulty);
      url.searchParams.set("run", freshRun);
      window.history.replaceState({}, "", url.toString());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => window.speechSynthesis?.cancel();
  }, []);

  // Neural TTS via /api/tts (Microsoft Edge voices), with browser fallback.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsVoice, setTtsVoice] = useState("en-US-AriaNeural");
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  // Browsers block audio until the first user gesture. Remember that so we can
  // voice the pending question the moment the candidate first interacts.
  const autoplayBlockedRef = useRef(false);
  const [speakNonce, setSpeakNonce] = useState(0);

  // Stop any playing audio when the question, voice toggle, or voice picker changes.
  // audioRef keeps the newest element so an interrupted voice switch never overlaps.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    const frame = window.requestAnimationFrame(() => setTtsSpeaking(false));
    return () => window.cancelAnimationFrame(frame);
  }, [question, voiceEnabled, ttsVoice]);

  // Barge-in: the moment the candidate starts speaking, the interviewer stops.
  useEffect(() => {
    if (!isListening) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    const frame = window.requestAnimationFrame(() => setTtsSpeaking(false));
    return () => window.cancelAnimationFrame(frame);
  }, [isListening]);

  // Auto-voice: the interviewer starts speaking as soon as a new question
  // arrives — including the opening line the moment the page loads — so the
  // candidate never has to click the orb first. The effect runs only when the
  // question or the voice settings change; the mic is deliberately NOT a
  // dependency, so starting/stopping the mic never replays the current
  // question (barge-in stays clean, and only the next turn is read aloud).
  useEffect(() => {
    if (!voiceEnabled) return;
    // listeningRef (not the isListening state) keeps this effect off the mic
    // toggle while still refusing to talk over the candidate.
    if (!question || listeningRef.current) return;
    let cancelled = false;
    const speak = async () => {
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: question, voice: ttsVoice }),
        });
        if (!response.ok) throw new Error(`TTS failed: ${response.status}`);
        const data = await response.json() as { audio?: string };
        if (!data.audio || cancelled) return;
        // If a newer voice switch happened while fetching, discard this audio.
        if (audioRef.current) {
          audioRef.current.pause();
        }
        const audio = new Audio(data.audio);
        audio.addEventListener("ended", () => setTtsSpeaking(false));
        audio.addEventListener("error", () => setTtsSpeaking(false));
        audioRef.current = audio;
        setTtsSpeaking(true);
        await audio.play();
      } catch (error) {
        if (cancelled) return;
        // Autoplay policy blocks sound until the candidate interacts; remember
        // it so the first tap/keypress replays this question.
        if (error instanceof DOMException && error.name === "NotAllowedError") autoplayBlockedRef.current = true;
        // Fallback to browser speech synthesis
        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(question);
          const voices = window.speechSynthesis.getVoices();
          const preferredVoice =
            voices.find((v) => /neural|natural/i.test(v.name) && /^en(-|_)/i.test(v.lang)) ||
            voices.find((v) => /^en(-|_)/i.test(v.lang));
          if (preferredVoice) utterance.voice = preferredVoice;
          utterance.rate = 0.92;
          utterance.onend = () => setTtsSpeaking(false);
          utterance.onerror = () => setTtsSpeaking(false);
          setTtsSpeaking(true);
          window.speechSynthesis.speak(utterance);
        } else {
          setTtsSpeaking(false);
        }
      }
    };
    void speak();
    return () => { cancelled = true; };
  }, [question, voiceEnabled, ttsVoice, speakNonce]);

  // First-gesture unlock: if the browser blocked the opening line, replay it the
  // moment the candidate touches the page (tap, click, or keypress).
  useEffect(() => {
    const unlock = () => {
      if (!autoplayBlockedRef.current) return;
      autoplayBlockedRef.current = false;
      window.speechSynthesis?.cancel();
      setSpeakNonce((value) => value + 1);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, []);

  const selectedNode = useMemo(
    () => architecture.nodes.find((node) => node.id === selected),
    [architecture.nodes, selected],
  );

  const nodeById = useMemo(() => new Map(architecture.nodes.map((node) => [node.id, node])), [architecture.nodes]);

  const aiState = micPermission === "denied" ? "error" : isListening ? "listening" : isSubmittingTurn || isTranscribing ? "processing" : ttsSpeaking ? "speaking" : "idle";
  const aiStateLabel = aiState === "speaking" ? "speaking" : aiState === "listening" ? "listening…" : aiState === "processing" ? "thinking…" : aiState === "error" ? "mic blocked" : "ready";
  const componentPrompts: Record<string, string> = {
    cache: "Why are you placing this cache here?",
    database: "Why did you choose this database for the workload?",
    messaging: "Why do you need asynchronous processing at this point?",
    networking: "What is this gateway or load balancer responsible for?",
    client: "What responsibility belongs at this client boundary?",
    compute: "What responsibility are you expecting this service to handle?",
    service: "What responsibility are you expecting this service to handle?",
    storage: "Why are you storing this data in object storage?",
  };
  // Tappable starter reasons that fill the inline answer box so a component
  // reply is one click plus an edit, instead of a blank text field.
  const componentSuggestions: Record<string, string[]> = {
    cache: ["Cuts read latency", "Offloads repeated queries from the database", "Absorbs traffic spikes"],
    database: ["Needs strong consistency for writes", "Relational schema with clear relationships", "Supports complex query patterns"],
    messaging: ["Decouples producers from consumers", "Smooths bursty write traffic", "Enables replay and backpressure"],
    networking: ["Terminates TLS and routes traffic", "Health-checks and load-balances backends", "Shields the backend from direct exposure"],
    client: ["Owns rendering and user input", "Keeps business logic server-side", "Stores the auth token securely"],
    compute: ["Stateless, so it scales horizontally", "Owns the business logic for this domain", "Sits behind the load balancer"],
    service: ["Stateless, so it scales horizontally", "Owns the business logic for this domain", "Sits behind the load balancer"],
    storage: ["Cheap durable storage for large objects", "Serves media without touching app servers", "Immutable versioned objects"],
  };
  const fallbackSuggestions = ["Handles this concern cleanly", "Improves scalability", "Simplifies the request flow"];
  const askAboutNode = (node: ArchitectureNode) => {
    setSelected(node.id);
    setActiveComponentId(node.id);
    setComponentQuestion(componentPrompts[node.type] || `Why are you placing ${node.label} here?`);
    setComponentDraft("");
    setShowEditTools(false);
  };
  const appendSuggestion = (text: string) => {
    setComponentDraft((current) => (current.trim() ? `${current.trim().replace(/[.\s]+$/, "")}. ${text}` : text));
  };

  const persistLive = (architectureValue: ArchitectureState, stateValue: InterviewState) => {
    if (!runToken) return;
    writeSnapshot(runToken, { scenario: scenarioName, difficulty: stateValue.difficulty, architecture: architectureValue, state: stateValue, startedAt: interviewStartedAtRef.current });
  };

  // Canvas-driven interview: when the candidate adds or removes a component or
  // a connection, the interviewer notices the edit and asks about it, then the
  // candidate edits again — the edit / react loop of a real design interview.
  // Position-only drags and zone moves are ignored; only structural changes
  // (nodes or edges appearing or disappearing) wake the interviewer.
  const architectureRef = useRef(architecture);
  const interviewStateRef = useRef(interviewState);
  const interviewEndedRef = useRef(false);
  const observedSignatureRef = useRef("");
  const observingRef = useRef(false);
  const observationTimerRef = useRef<number | null>(null);

  useEffect(() => { architectureRef.current = architecture; }, [architecture]);
  useEffect(() => { interviewStateRef.current = interviewState; }, [interviewState]);
  useEffect(() => { interviewEndedRef.current = interviewEnded; }, [interviewEnded]);

  const structureSignature = (value: ArchitectureState) => JSON.stringify({
    nodes: value.nodes.map((node) => node.id).sort(),
    edges: value.edges.map((edge) => `${edge.source}->${edge.target}`).sort(),
  });

  const isStructuralChange = (prev: ArchitectureState, next: ArchitectureState) =>
    prev.nodes.length !== next.nodes.length
    || prev.edges.length !== next.edges.length
    || prev.nodes.some((node, index) => node.id !== next.nodes[index]?.id)
    || prev.edges.some((edge, index) => edge.id !== next.edges[index]?.id);

  const runObservation = async () => {
    if (observingRef.current || submittingTurnRef.current || listeningRef.current || interviewEndedRef.current) return;
    if (!runToken) return;
    observingRef.current = true;
    try {
      const currentArchitecture = architectureRef.current;
      const stateForRequest = { ...interviewStateRef.current, architectureSnapshot: currentArchitecture };
      const sentSignature = structureSignature(currentArchitecture);
      const response = await fetch("/api/interview/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateForRequest, answer: "", mode: "observe" }),
      });
      const result = await response.json() as { turn?: InterviewTurn; error?: string };
      if (response.ok && result.turn) {
        const nextState = applyObservationTurn(stateForRequest, result.turn);
        interviewStateRef.current = nextState;
        observedSignatureRef.current = sentSignature;
        setInterviewState(nextState);
        persistLive(currentArchitecture, nextState);
        setQuestion(nextState.currentQuestionData?.text || result.turn.message || result.turn.question);
      }
    } catch {
      // A failed observation must never interrupt the candidate's flow.
    } finally {
      observingRef.current = false;
      // If the canvas changed again while the interviewer was talking, react to
      // that too instead of silently dropping the edit.
      if (!interviewEndedRef.current && structureSignature(architectureRef.current) !== observedSignatureRef.current) {
        if (observationTimerRef.current) window.clearTimeout(observationTimerRef.current);
        observationTimerRef.current = window.setTimeout(() => { observationTimerRef.current = null; void runObservation(); }, 800);
      }
    }
  };

  const scheduleObservation = () => {
    if (observationTimerRef.current) window.clearTimeout(observationTimerRef.current);
    observationTimerRef.current = window.setTimeout(() => { observationTimerRef.current = null; void runObservation(); }, 1400);
  };

  const updateArchitecture = (next: ArchitectureState) => {
    const changed = isStructuralChange(architecture, next);
    setArchitecture(next);
    const nextState = { ...interviewState, architectureSnapshot: next };
    setInterviewState(nextState);
    persistLive(next, nextState);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
    void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "architecture.updated", metadata: { nodeCount: next.nodes.length } }) });
    if (changed) scheduleObservation();
  };

  const viewportCenterWorld = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
    return { x: (rect.width / 2 - view.x) / view.zoom, y: (rect.height / 2 - view.y) / view.zoom };
  };

  const addService = () => {
    const name = newServiceName.trim();
    if (!name) return;
    const type = newServiceType === "auto" ? inferArchitectureType(name) : newServiceType;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "service";
    const id = `${slug}-${nextId.current++}`;
    const center = viewportCenterWorld();
    const jitter = (architecture.nodes.length % 5) * 34;
    const node: ArchitectureNode = {
      id,
      type,
      label: name,
      x: clamp(((center.x + jitter) / WORLD_WIDTH) * 100, 2, 98),
      y: clamp(((center.y + jitter) / WORLD_HEIGHT) * 100, 2, 98),
      reasoning: "",
      note: "",
    };
    const placed: ArchitectureNode = { ...node, zone: zoneContaining(node, architecture.zones)?.id };
    updateArchitecture({ ...architecture, nodes: [...architecture.nodes, placed] });
    setSelected(id);
    setNewServiceName("");
    setNewServiceType("auto");
    setAddServiceOpen(false);
  };

  const updateZone = (zoneId: string, changes: Partial<ArchitectureZone>) => {
    updateArchitecture({ ...architecture, zones: (architecture.zones || []).map((zone) => (zone.id === zoneId ? { ...zone, ...changes } : zone)) });
  };

  const deleteZone = (zoneId: string) => {
    updateArchitecture({
      ...architecture,
      zones: (architecture.zones || []).filter((zone) => zone.id !== zoneId),
      nodes: architecture.nodes.map((node) => (node.zone === zoneId ? { ...node, zone: undefined } : node)),
    });
    setEditingZoneId((current) => (current === zoneId ? null : current));
    setSelectedZone((current) => (current === zoneId ? null : current));
  };

  const showConnectionError = (message: string) => {
    setConnectionError(message);
    if (connectionErrorTimerRef.current) window.clearTimeout(connectionErrorTimerRef.current);
    connectionErrorTimerRef.current = window.setTimeout(() => setConnectionError(""), 3200);
  };

  const updateNode = (changes: Partial<ArchitectureNode>) => {
    if (!selectedNode) return;
    updateArchitecture({
      ...architecture,
      nodes: architecture.nodes.map((node) => node.id === selected ? { ...node, ...changes } : node),
    });
  };

  const deleteNode = (nodeId: string) => {
    const nodes = architecture.nodes.filter((node) => node.id !== nodeId);
    const edges = architecture.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
    updateArchitecture({ ...architecture, nodes, edges });
    setSelected(nodes[0]?.id || "");
    setSelectedEdge((current) => (current && edges.some((edge) => edge.id === current) ? current : null));
  };

  const selectEdge = (edgeId: string) => {
    setSelectedEdge(edgeId);
    setSelected("");
    setActiveComponentId(null);
    setShowEditTools(false);
  };

  const deleteEdge = (edgeId: string) => {
    setSelectedEdge(null);
    updateArchitecture({ ...architecture, edges: architecture.edges.filter((edge) => edge.id !== edgeId) });
  };

  const duplicateSelected = () => {
    if (!selectedNode) return;
    const id = `${selectedNode.id}-copy-${nextId.current++}`;
    const copy = { ...selectedNode, id, label: `${selectedNode.label} copy`, x: Math.min(selectedNode.x + 8, 82), y: Math.min(selectedNode.y + 8, 78) };
    updateArchitecture({ ...architecture, nodes: [...architecture.nodes, copy] });
    setSelected(id);
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - view.x) / view.zoom, y: (clientY - rect.top - view.y) / view.zoom };
  };

  const connectionBlockReason = (source: ArchitectureNode, target: ArchitectureNode): string | null => {
    if (architecture.edges.some((edge) => edge.source === source.id && edge.target === target.id)) {
      return `${source.label} is already connected to ${target.label}.`;
    }
    return connectionRuleError(source, target);
  };

  const finishConnection = (clientX: number, clientY: number) => {
    const from = connectionStart;
    setConnectionStart(null);
    setConnectPointer(null);
    if (!from) return;
    const source = architecture.nodes.find((node) => node.id === from.fromNode);
    if (!source) return;
    const element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const holder = element?.closest<HTMLElement>("[data-node-id]");
    if (!holder) return;
    const target = architecture.nodes.find((node) => node.id === holder.dataset.nodeId);
    if (!target) return;
    const targetSide = (holder.dataset.portSide as "left" | "right" | undefined) || (from.fromSide === "right" ? "left" : "right");
    const targetIndex = holder.dataset.portIndex !== undefined ? Number(holder.dataset.portIndex) : Math.floor((PORTS_PER_SIDE - 1) / 2);
    const blocked = connectionBlockReason(source, target);
    if (blocked) {
      showConnectionError(blocked);
      return;
    }
    updateArchitecture({
      ...architecture,
      edges: [...architecture.edges, { id: `edge-${nextEdgeId.current++}`, source: source.id, target: target.id, label: "request", sourceHandle: `${from.fromSide}-${from.fromIndex}`, targetHandle: `${targetSide}-${targetIndex}` }],
    });
  };

  const handleNodePointerDown = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    event.stopPropagation();
    if (event.button !== 0 && event.pointerType === "mouse") return;
    setSelected(id);
    setSelectedEdge(null);
    const node = architecture.nodes.find((item) => item.id === id);
    if (!node) return;
    dragRef.current = { id, startPointerX: event.clientX, startPointerY: event.clientY, startNodeX: node.x, startNodeY: node.y, moved: false };
  };

  const startConnection = (event: PointerEvent<HTMLElement>, nodeId: string, side: "left" | "right", index: number) => {
    event.stopPropagation();
    event.preventDefault();
    setConnectionStart({ fromNode: nodeId, fromSide: side, fromIndex: index });
    setConnectPointer(screenToWorld(event.clientX, event.clientY));
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const handleZoneHeaderPointerDown = (event: PointerEvent<HTMLDivElement>, zone: ArchitectureZone) => {
    event.stopPropagation();
    if (event.button !== 0 && event.pointerType === "mouse") return;
    setSelectedZone(zone.id);
    setActiveComponentId(null);
    setShowEditTools(false);
    // Snapshot the nodes sitting inside so the whole group moves with the box.
    const members = architecture.nodes.filter((node) => pointInZone(node, zone)).map((node) => ({ id: node.id, x: node.x, y: node.y }));
    zoneDragRef.current = { id: zone.id, startPointerX: event.clientX, startPointerY: event.clientY, startX: zone.x, startY: zone.y, members };
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const handleZoneResizePointerDown = (event: PointerEvent<HTMLSpanElement>, zone: ArchitectureZone) => {
    event.stopPropagation();
    if (event.button !== 0 && event.pointerType === "mouse") return;
    setSelectedZone(zone.id);
    zoneResizeRef.current = { id: zone.id, startPointerX: event.clientX, startPointerY: event.clientY, startWidth: zone.width, startHeight: zone.height };
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [role='dialog'], .edit-popover")) return;
    if (event.pointerType === "touch" && !event.isPrimary) return;
    setActiveComponentId(null);
    setShowEditTools(false);
    setSelectedEdge(null);
    panRef.current = { startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y };
    canvasRef.current?.setPointerCapture(event.pointerId);
  };

  const handleCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (zoneDragRef.current) {
      const drag = zoneDragRef.current;
      const zone = (architecture.zones || []).find((item) => item.id === drag.id);
      if (!zone) return;
      const dx = (((event.clientX - drag.startPointerX) / view.zoom) / WORLD_WIDTH) * 100;
      const dy = (((event.clientY - drag.startPointerY) / view.zoom) / WORLD_HEIGHT) * 100;
      const nextX = clamp(drag.startX + dx, 0, 100 - zone.width);
      const nextY = clamp(drag.startY + dy, 0, 100 - zone.height);
      const shiftX = nextX - drag.startX;
      const shiftY = nextY - drag.startY;
      setArchitecture((current) => ({
        ...current,
        zones: (current.zones || []).map((item) => (item.id === drag.id ? { ...item, x: nextX, y: nextY } : item)),
        nodes: current.nodes.map((node) => {
          const member = drag.members.find((item) => item.id === node.id);
          return member ? { ...node, x: clamp(member.x + shiftX, 1, 99), y: clamp(member.y + shiftY, 1, 99) } : node;
        }),
      }));
      return;
    }
    if (zoneResizeRef.current) {
      const resize = zoneResizeRef.current;
      const zone = (architecture.zones || []).find((item) => item.id === resize.id);
      if (!zone) return;
      const dw = (((event.clientX - resize.startPointerX) / view.zoom) / WORLD_WIDTH) * 100;
      const dh = (((event.clientY - resize.startPointerY) / view.zoom) / WORLD_HEIGHT) * 100;
      const width = clamp(resize.startWidth + dw, MIN_ZONE_WIDTH, 100 - zone.x);
      const height = clamp(resize.startHeight + dh, MIN_ZONE_HEIGHT, 100 - zone.y);
      setArchitecture((current) => ({ ...current, zones: (current.zones || []).map((item) => (item.id === resize.id ? { ...item, width, height } : item)) }));
      return;
    }
    if (dragRef.current) {
      const dx = (event.clientX - dragRef.current.startPointerX) / view.zoom;
      const dy = (event.clientY - dragRef.current.startPointerY) / view.zoom;
      if (Math.abs(event.clientX - dragRef.current.startPointerX) > 3 || Math.abs(event.clientY - dragRef.current.startPointerY) > 3) dragRef.current.moved = true;
      const id = dragRef.current.id;
      const nextX = clamp(dragRef.current.startNodeX + (dx / WORLD_WIDTH) * 100, 1, 99);
      const nextY = clamp(dragRef.current.startNodeY + (dy / WORLD_HEIGHT) * 100, 1, 99);
      setArchitecture((current) => ({ ...current, nodes: current.nodes.map((node) => (node.id === id ? { ...node, x: nextX, y: nextY } : node)) }));
      return;
    }
    if (panRef.current) {
      setView((current) => ({ ...current, x: panRef.current!.originX + (event.clientX - panRef.current!.startX), y: panRef.current!.originY + (event.clientY - panRef.current!.startY) }));
      return;
    }
    if (connectionStart) {
      setConnectPointer(screenToWorld(event.clientX, event.clientY));
    }
  };

  const handleCanvasPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (connectionStart) finishConnection(event.clientX, event.clientY);
    if (zoneDragRef.current) {
      zoneDragRef.current = null;
      updateArchitecture({ ...architecture, nodes: assignZones(architecture.nodes, architecture.zones) });
    } else if (zoneResizeRef.current) {
      zoneResizeRef.current = null;
      persistLive(architecture, interviewState);
    }
    if (dragRef.current) {
      const finishedDrag = dragRef.current;
      dragRef.current = null;
      if (finishedDrag.moved) {
        const nodes = assignZones(architecture.nodes, architecture.zones);
        if (nodes.some((node, index) => (node.zone || undefined) !== (architecture.nodes[index].zone || undefined))) {
          updateArchitecture({ ...architecture, nodes });
        } else {
          persistLive(architecture, interviewState);
        }
      } else {
        const node = architecture.nodes.find((item) => item.id === finishedDrag.id);
        if (node) askAboutNode(node);
      }
    }
    panRef.current = null;
  };

  const zoomBy = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setView((current) => {
      const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const k = zoom / current.zoom;
      return { zoom, x: cx - k * (cx - current.x), y: cy - k * (cy - current.y) };
    });
  };

  const fitViewTo = useCallback((nodes: ArchitectureNode[]) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || nodes.length === 0) return;
    const xs = nodes.map((node) => (node.x / 100) * WORLD_WIDTH);
    const ys = nodes.map((node) => (node.y / 100) * WORLD_HEIGHT);
    const minX = Math.min(...xs) - 140;
    const maxX = Math.max(...xs) + 140;
    const minY = Math.min(...ys) - 120;
    const maxY = Math.max(...ys) + 120;
    // On a phone the canvas is narrow, so a pure "fit everything" zoom shrinks
    // the nodes below a comfortable tap target. Floor the starting zoom when the
    // pointer is coarse or the canvas is phone-sized, and let the user pan.
    const touchFloor =
      typeof window !== "undefined" && (window.matchMedia("(pointer: coarse)").matches || rect.width < 720)
        ? 0.6
        : MIN_ZOOM;
    const zoom = clamp(Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)), touchFloor, 1.4);
    setView({ zoom, x: rect.width / 2 - zoom * ((minX + maxX) / 2), y: rect.height / 2 - zoom * ((minY + maxY) / 2) });
  }, []);

  // Fit the starting design into view once on mount; later edits keep the user's view.
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => fitViewTo(architecture.nodes));
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wheel zoom needs a non-passive listener so the page doesn't scroll behind it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((current) => {
        const zoom = clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM);
        const k = zoom / current.zoom;
        return { zoom, x: mouseX - k * (mouseX - current.x), y: mouseY - k * (mouseY - current.y) };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const moveSelectedNode = (xDelta: number, yDelta: number) => {
    if (!selectedNode) return;
    const moved = architecture.nodes.map((node) => node.id === selected
      ? { ...node, x: clamp(node.x + xDelta, 1, 99), y: clamp(node.y + yDelta, 1, 99) }
      : node);
    updateArchitecture({ ...architecture, nodes: assignZones(moved, architecture.zones) });
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length === 2 && canvasRef.current) {
      panRef.current = null;
      dragRef.current = null;
      const rect = canvasRef.current.getBoundingClientRect();
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      pinchRef.current = {
        dist: Math.hypot(dx, dy),
        zoom: view.zoom,
        x: view.x,
        y: view.y,
        cx: (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left,
        cy: (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top,
      };
    }
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const pinch = pinchRef.current;
    if (event.touches.length !== 2 || !pinch || !canvasRef.current) return;
    event.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const centerX = (event.touches[0].clientX + event.touches[1].clientX) / 2 - rect.left;
    const centerY = (event.touches[0].clientY + event.touches[1].clientY) / 2 - rect.top;
    const zoom = clamp(pinch.zoom * (dist / pinch.dist), MIN_ZOOM, MAX_ZOOM);
    const k = zoom / pinch.zoom;
    setView({ zoom, x: centerX - k * (pinch.cx - pinch.x), y: centerY - k * (pinch.cy - pinch.y) });
  };

  const handleTouchEnd = () => {
    pinchRef.current = null;
  };

  const exportArchitecture = () => {
    const blob = new Blob([JSON.stringify(architecture, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-architecture.json`;
    link.click();
    URL.revokeObjectURL(url);
    setStorageMessage("Architecture JSON downloaded.");
  };

  const importArchitecture = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result)) as ArchitectureState;
        if (!Array.isArray(imported.nodes) || !Array.isArray(imported.edges)) throw new Error("invalid shape");
        updateArchitecture(imported);
        setSelected(imported.nodes[0]?.id || "");
        setStorageMessage("Architecture JSON imported.");
      } catch {
        setStorageMessage("That file is not a valid Blueprint architecture export.");
      }
      event.target.value = "";
    };
    reader.readAsText(file);
  };

  // The whisper request slot is a single pending promise; a newer transcription
  // supersedes an older one so a stale partial caption can never wedge the slot.
  const transcribeWithWhisper = (samples: Float32Array): Promise<string> =>
    new Promise((resolve, reject) => {
      const worker = getWhisperWorker();
      const id = ++whisperRequestIdRef.current;
      whisperPendingRef.current?.reject(new Error("superseded"));
      whisperPendingRef.current = { id, resolve, reject };
      worker.postMessage({ action: "transcribe", id, audio: samples } satisfies WhisperRequest);
    });

  // Transcribe the trailing part of the live capture so a caption appears while
  // the candidate is still talking. The window is a rolling slice to keep
  // transcription latency low on long answers.
  const LIVE_CAPTION_WINDOW = 14 * 16000; // 14 s of mono 16 kHz PCM.
  const capturePartialCaption = async () => {
    if (!listeningRef.current || liveTranscribingRef.current) return;
    const samples = liveSamplesRef.current;
    if (!samples || samples.length < 4800) return;
    liveTranscribingRef.current = true;
    try {
      const windowSamples = samples.length > LIVE_CAPTION_WINDOW ? samples.subarray(samples.length - LIVE_CAPTION_WINDOW) : samples;
      const text = (await transcribeWithWhisper(windowSamples)).trim();
      if (listeningRef.current && text) setVoiceTranscript(text);
    } catch {
      // A failed partial caption must never interrupt a live answer.
    } finally {
      liveTranscribingRef.current = false;
    }
  };

  const teardownLiveCapture = () => {
    if (liveTimerRef.current) {
      window.clearInterval(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    try { liveProcessorRef.current?.disconnect(); } catch { /* already stopped */ }
    try { liveSourceRef.current?.disconnect(); } catch { /* already stopped */ }
    try { void liveContextRef.current?.close(); } catch { /* already stopped */ }
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveProcessorRef.current = null;
    liveSourceRef.current = null;
    liveContextRef.current = null;
    liveStreamRef.current = null;
    liveSamplesRef.current = null;
  };

  // Tap to talk: 16 kHz PCM accumulates live and is transcribed in rolling
  // windows so the interviewer sees a caption as you speak. Tapping again
  // finalizes the full recording, transcribes it once more, and sends it
  // straight to the AI — no answer box in the way.
  const startListening = async () => {
    if (isListening || isSubmittingTurn || submittingTurnRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermission("granted");
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) throw new Error("Live audio capture is unavailable in this browser.");
      const context = new AudioContextClass({ sampleRate: 16000 });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (event) => {
        const data = event.inputBuffer.getChannelData(0);
        const current = liveSamplesRef.current || new Float32Array(0);
        const next = new Float32Array(current.length + data.length);
        next.set(current, 0);
        next.set(data, current.length);
        liveSamplesRef.current = next;
      };
      source.connect(processor);
      processor.connect(context.destination);
      liveStreamRef.current = stream;
      liveContextRef.current = context;
      liveSourceRef.current = source;
      liveProcessorRef.current = processor;
      liveSamplesRef.current = new Float32Array(0);
      listeningRef.current = true;
      setIsListening(true);
      setIsTranscribing(false);
      setVoiceTranscript("");
      setMicStatus("");
      liveTimerRef.current = window.setInterval(() => { void capturePartialCaption(); }, 2400);
    } catch {
      setMicPermission("denied");
      setMicStatus("Microphone access is blocked. Allow it in your browser settings, then tap the mic again.");
    }
  };

  const stopListening = async () => {
    if (!isListening) return;
    listeningRef.current = false;
    setIsListening(false);
    const samples = liveSamplesRef.current || new Float32Array(0);
    teardownLiveCapture();
    // ~0.2 s or less is not a real answer.
    if (samples.length < 3200) {
      setVoiceTranscript("");
      setMicStatus("No speech heard — tap the mic and speak again.");
      return;
    }
    setIsTranscribing(true);
    setMicStatus("Transcribing on your device…");
    try {
      const fullText = (await transcribeWithWhisper(samples)).trim();
      if (!fullText) {
        setVoiceTranscript("");
        setMicStatus("No clear speech detected — try once more.");
        return;
      }
      setWhisperModelState("ready");
      setVoiceTranscript(fullText);
      setMicStatus("");
      await submitAnswer(fullText);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMicStatus(/network|offline|fetch|download|load|superseded/i.test(message)
        ? "The speech model needs a one-time download — check your connection and try once more. After that it works offline."
        : `Voice transcription failed (${message}). You can still continue the interview.`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const submitAnswer = async (submittedAnswer?: string) => {
    const answerToSubmit = (submittedAnswer || "").trim();
    if (!answerToSubmit || submittingTurnRef.current) return;
    submittingTurnRef.current = true;
    setIsSubmittingTurn(true);
    try {
      const stateForRequest = { ...interviewState, architectureSnapshot: architecture };
      const response = await fetch("/api/interview/next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: stateForRequest, answer: answerToSubmit }),
      });
      const result = await response.json() as { turn?: InterviewTurn; error?: string };
      if (!response.ok || !result.turn) {
        setQuestion(result.error || "The interviewer could not continue. Check your answer and try again.");
        return;
      }
      const nextState = applyInterviewTurn(stateForRequest, answerToSubmit, result.turn);
      setInterviewState(nextState);
      persistLive(architecture, nextState);
      void fetch("/api/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "interview.turn_submitted", metadata: { scenario: scenarioName, phase: interviewState.phase } }) });
      setVoiceTranscript("");
      setMicStatus("");
      // Use the applied state's text: when the model looped on a question,
      // applyInterviewTurn replaced it, and the caption must show the fresh one.
      setQuestion(nextState.currentQuestionData?.text || result.turn.message || result.turn.question);
    } finally {
      submittingTurnRef.current = false;
      setIsSubmittingTurn(false);
    }
  };

  // Submit an answer typed directly in the component popover, then close it so
  // the next interviewer turn lands in the sidebar caption.
  const submitComponentAnswer = async () => {
    const draft = componentDraft.trim();
    if (!draft || componentSubmitting) return;
    setComponentSubmitting(true);
    try {
      await submitAnswer(draft);
      setComponentDraft("");
      setActiveComponentId(null);
    } finally {
      setComponentSubmitting(false);
    }
  };

  const generateEvaluation = async () => {
    setIsEvaluating(true);
    // Choosing to end is final: stop reacting to canvas edits the moment the
    // scorecard is requested, even if generation is still in flight.
    interviewEndedRef.current = true;
    setInterviewEnded(true);
    if (observationTimerRef.current) {
      window.clearTimeout(observationTimerRef.current);
      observationTimerRef.current = null;
    }
    try {
      const response = await fetch("/api/interviews/evaluation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenario: scenarioName, architecture, turns: interviewState.answers.length, answers: interviewState.answers }),
      });
      const result = await response.json() as { report?: EvaluationReport; error?: string };
      if (response.ok && result.report) {
        setEvaluationReport(result.report);
        persistLive(architecture, interviewState);
        saveLocalHistoryItem({
          id: runToken || newRunToken(),
          scenario: scenarioName,
          difficulty: interviewState.difficulty,
          completedAt: new Date().toISOString(),
          architectureHealth: validateArchitecture(architecture).score,
          evaluationScore: result.report.score,
          run: runToken,
        });
      } else {
        setStorageMessage(result.error || "The scorecard could not be generated. Close this and end the interview again.");
      }
    } finally {
      setIsEvaluating(false);
    }
  };

  // Render the architecture to a PNG for the scorecard. Best-effort: the
  // scorecard is complete without it, so a failed render is silently ignored.
  const captureDiagram = async () => {
    try {
      setEvaluationDiagram(await architecturePNGDataURL(architecture));
    } catch {
      setEvaluationDiagram("");
    }
  };

  const endInterview = () => {
    setShowEndConfirm(false);
    setShowScorecard(true);
    void captureDiagram();
    void generateEvaluation();
  };

  // Auto-end at the 40-minute cap: stop capturing (without submitting the
  // partial answer), silence the interviewer, flag the reason, then produce the
  // same architecture diagram and evaluation a manual end would.
  const autoEndInterview = () => {
    if (interviewEndedRef.current) return;
    listeningRef.current = false;
    setIsListening(false);
    teardownLiveCapture();
    setVoiceTranscript("");
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setTtsSpeaking(false);
    setTimeLimitReached(true);
    setStorageMessage("You reached the 40-minute limit — the interview ended automatically and your scorecard is ready.");
    setShowEndConfirm(false);
    setShowScorecard(true);
    void captureDiagram();
    void generateEvaluation();
  };

  // Ticking countdown for the visible timer. It also fires the hard cap; the
  // interviewEndedRef guard keeps it from firing twice.
  useEffect(() => {
    if (!interviewStartedAt || interviewEnded) return;
    const tick = () => {
      const left = Math.max(0, INTERVIEW_MAX_MS - (Date.now() - interviewStartedAt));
      setRemainingMs(left);
      if (left <= 0) autoEndInterview();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- autoEndInterview is stable for the interview's lifetime
  }, [interviewStartedAt, interviewEnded]);

  // Download the interview as a self-contained HTML document: transcript,
  // architecture diagram, scoring breakdown, and scorecard. It is generated
  // entirely in the browser, so a finished interview needs no server storage.
  const downloadTranscript = async () => {
    const validation = validateArchitecture(architecture);
    let imageDataURL = "";
    try {
      imageDataURL = await architecturePNGDataURL(architecture);
    } catch {
      // The image is nice-to-have; the document still works without it.
    }
    const doc = buildTranscriptDoc({
      scenario: scenarioName,
      difficulty: interviewState.difficulty,
      completedAt: new Date().toISOString(),
      architecture,
      validation,
      interviewState,
      evaluation: evaluationReport,
      imageDataURL,
    });
    const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-interview-${new Date().toISOString().slice(0, 10)}.html`;
    link.click();
    URL.revokeObjectURL(url);
    setStorageMessage("Interview document downloaded — keep it as your record, nothing was stored on the server.");
  };

  // Skip/restart controls were intentionally removed: the interview runs
  // forward from the scenario's client-only canvas, and restarting an
  // interview is a deliberate browser-level action, not a canvas button.

  return <main className="shell">
    <nav className="nav nav-workspace" style={{ background: "var(--canvas)", borderBottom: "1px solid var(--line)" }}><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link><div className="nav-links"><span className="nav-workspace-scenario" style={{ color: "var(--muted)" }}>{scenarioName} / {interviewState.difficulty}</span>{interviewStartedAt > 0 && (interviewEnded ? <span className="interview-timer interview-timer-done" title="Interview time is up">time up</span> : <span className={`interview-timer ${remainingMs <= INTERVIEW_WARN_MS ? "interview-timer-low" : ""}`} title="Time remaining in this interview">{formatClock(remainingMs)} left</span>)}<span className="status">● Interview live</span></div></nav>
    <div className="interview-layout">
      <section className="canvas-panel">
        <div className="workspace-header"><div><div className="eyebrow">Phase {String(Math.max(1, interviewPhases.indexOf(interviewState.phase) + 1)).padStart(2, "0")} / {interviewState.phase.replaceAll("_", " ")}</div><h1 className="workspace-title">{scenarioName} <span className="save-indicator">{saved ? "saved locally" : `${architecture.nodes.length} nodes · ${architecture.edges.length} edges`}</span></h1></div><span className="conversation-mode">{interviewState.conversationMode || "discussion"} / live</span></div>
        <div className="ai-workspace-actions"><span className="ai-orb" aria-hidden="true">✦</span><span><strong>Architecture tools</strong><small>Add components, connect them on the canvas, and manage your architecture backup.</small></span><div className="ai-action-menu"><button className="tool-button" onClick={() => setAddServiceOpen((open) => !open)}>＋ Add service</button>{addServiceOpen && <div className="add-service-form"><input autoFocus value={newServiceName} onChange={(event) => setNewServiceName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addService(); } }} placeholder="Name it — Kafka, Cassandra, message queue…" aria-label="New service name" /><select value={newServiceType} onChange={(event) => setNewServiceType(event.target.value as ArchitectureType | "auto")} aria-label="New service type"><option value="auto">Auto-detect type</option>{ARCHITECTURE_TYPES.map((type) => <option key={type} value={type}>{architectureTypeLabel(type)}</option>)}</select><button className="primary-button" onClick={addService} disabled={!newServiceName.trim()}>Add ↗</button></div>}<button className="tool-button" onClick={() => { if (selected) deleteNode(selected); }} disabled={!selected} title="Delete the selected component">Delete component</button><button className="tool-button" onClick={() => { if (selectedEdge) deleteEdge(selectedEdge); }} disabled={!selectedEdge} title="Delete the selected wire connection">Delete connection</button><button className="tool-button" onClick={exportArchitecture}>Export JSON</button><label className="file-button tool-button">Import JSON<input type="file" accept="application/json,.json" onChange={importArchitecture} /></label>{storageMessage && <span role="status">{storageMessage}</span>}</div></div>
        {connectionError ? <p className="canvas-hint canvas-error" role="alert">✕ {connectionError}</p> : <p className="canvas-hint">Drag empty space to pan · scroll or pinch to zoom · drag a port ○ onto another component to connect · the interviewer notices every change you make.</p>}
        <div ref={canvasRef} className="architecture-canvas" role="application" aria-label="Architecture design canvas. Drag empty space to pan, scroll or pinch to zoom, drag a port onto another component to connect, and drag components to move them." onPointerDown={handleCanvasPointerDown} onPointerMove={handleCanvasPointerMove} onPointerUp={handleCanvasPointerUp} onPointerLeave={handleCanvasPointerUp} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
          <div className="canvas-world" style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, "--zoom": String(view.zoom) } as CSSProperties}>
            {(architecture.zones || []).map((zone) => <div key={zone.id} className={`canvas-zone ${selectedZone === zone.id ? "zone-selected" : ""}`} style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%` }}>
              <div className="canvas-zone-header" onPointerDown={(event) => handleZoneHeaderPointerDown(event, zone)}>
                <span className="canvas-zone-label" onDoubleClick={() => setEditingZoneId(zone.id)}>{zone.label}</span>
                {zone.provider && <span className="zone-provider-badge">{architectureProviderLabel(zone.provider)}</span>}
                <span className="zone-header-actions">
                  <button type="button" aria-label={`Edit ${zone.label}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setEditingZoneId((current) => (current === zone.id ? null : zone.id))}>✎</button>
                  <button type="button" aria-label={`Delete ${zone.label}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => deleteZone(zone.id)}>×</button>
                </span>
              </div>
              {editingZoneId === zone.id && <div className="zone-edit-form" onPointerDown={(event) => event.stopPropagation()}><input value={zone.label} onChange={(event) => updateZone(zone.id, { label: event.target.value })} aria-label="Zone label" /><select value={zone.provider || ""} onChange={(event) => updateZone(zone.id, { provider: event.target.value || undefined })} aria-label="Zone provider"><option value="">No provider</option>{ARCHITECTURE_PROVIDERS.map((provider) => <option key={provider} value={provider}>{architectureProviderLabel(provider)}</option>)}</select><button type="button" className="tool-button" onClick={() => setEditingZoneId(null)}>Done</button></div>}
              <span className="canvas-zone-resize" aria-hidden="true" onPointerDown={(event) => handleZoneResizePointerDown(event, zone)} />
            </div>)}
            <svg className="canvas-edges" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}>{architecture.edges.map((edge) => { const source = nodeById.get(edge.source); const target = nodeById.get(edge.target); if (!source || !target) return null; const [sourceSide, sourceIndex] = parseHandle(edge.sourceHandle, "right"); const [targetSide, targetIndex] = parseHandle(edge.targetHandle, "left"); const a = portWorldPosition(source, sourceSide, sourceIndex); const b = portWorldPosition(target, targetSide, targetIndex); const isSelected = selectedEdge === edge.id; const midX = (a.x + b.x) / 2; const midY = (a.y + b.y) / 2; return <g key={edge.id}><line className="canvas-edge-hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} role="button" tabIndex={0} aria-label={`Connection from ${source.label} to ${target.label}. Press Enter to select it, then use Delete connection to remove it.`} onPointerDown={(event) => { event.stopPropagation(); selectEdge(edge.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectEdge(edge.id); } }} /><line className={`canvas-edge ${isSelected ? "canvas-edge-selected" : ""}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />{isSelected && <g className="edge-delete" role="button" tabIndex={0} aria-label={`Delete connection from ${source.label} to ${target.label}`} onPointerDown={(event) => { event.stopPropagation(); deleteEdge(edge.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); deleteEdge(edge.id); } }}><circle cx={midX} cy={midY} r={11} /><text x={midX} y={midY} textAnchor="middle" dominantBaseline="central">×</text></g>}</g>; })}{connectionStart && connectPointer && (() => { const source = nodeById.get(connectionStart.fromNode); if (!source) return null; const a = portWorldPosition(source, connectionStart.fromSide, connectionStart.fromIndex); return <line className="canvas-edge canvas-edge-draft" x1={a.x} y1={a.y} x2={connectPointer.x} y2={connectPointer.y} />; })()}</svg>
            {/* eslint-disable-next-line react-hooks/refs -- drag/connect handlers below read refs only inside events */}
            {architecture.nodes.map((node) => <div key={node.id} className="node-wrap" style={{ left: `${node.x}%`, top: `${node.y}%` }}>
              <button type="button" data-node-id={node.id} onPointerDown={(event) => handleNodePointerDown(event, node.id)} onKeyDown={(event) => { if (event.key === "ArrowLeft") moveSelectedNode(-2, 0); if (event.key === "ArrowRight") moveSelectedNode(2, 0); if (event.key === "ArrowUp") moveSelectedNode(0, -2); if (event.key === "ArrowDown") moveSelectedNode(0, 2); if (event.key === "Enter") askAboutNode(node); }} aria-label={`${node.label} component. Press Enter to answer about it.`} className={`architecture-node ${selected === node.id ? "node-selected" : ""}`}><span className="node-remove" role="button" tabIndex={0} aria-label={`Remove ${node.label}`} onPointerDown={(event) => { event.stopPropagation(); deleteNode(node.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); deleteNode(node.id); } }}>×</span><span className="dot lime" aria-hidden="true" /><strong>{node.label}</strong><span className="node-type">{architectureTypeLabel(node.type)} / node</span>{node.provider && <span className="node-provider-tag">{architectureProviderLabel(node.provider)}</span>}{nodeTopologyLabel(node) && <span className="node-badges">{nodeTopologyLabel(node)}</span>}</button>
              {(["left", "right"] as const).map((side) => Array.from({ length: PORTS_PER_SIDE }).map((_, index) => <button key={`${side}-${index}`} type="button" className={`node-port node-port-${side}`} data-node-id={node.id} data-port-side={side} data-port-index={index} style={{ top: `calc(50% + ${(index - (PORTS_PER_SIDE - 1) / 2) * 20}px)` }} onPointerDown={(event) => startConnection(event, node.id, side, index)} aria-label={`Drag from the ${side} port of ${node.label} to connect another component`} />))}
              {selected === node.id && <div className="node-actions" onPointerDown={(event) => event.stopPropagation()}><button onClick={() => setShowEditTools(true)}>Edit</button><button onClick={() => duplicateSelected()}>Duplicate</button><button className="node-action-delete" onClick={() => deleteNode(node.id)}>Delete</button></div>}
              {activeComponentId === node.id && <div className="component-popover" onPointerDown={(event) => event.stopPropagation()} role="dialog" aria-label={`Question about ${node.label}`}><button className="popover-close" aria-label="Close component question" onClick={() => setActiveComponentId(null)}>×</button><span className="eyebrow">Component / {node.label}</span><p>{componentQuestion}</p><div className="component-suggestions">{(componentSuggestions[node.type] || fallbackSuggestions).map((text) => <button key={text} type="button" className="suggestion-chip" onClick={() => appendSuggestion(text)}>{text}</button>)}</div><textarea className="component-answer" aria-label={`Your answer about ${node.label}`} placeholder="Answer the interviewer… Enter to send, Shift+Enter for a new line." value={componentDraft} onChange={(event) => setComponentDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitComponentAnswer(); } }} /><div className="component-popover-actions"><button className="primary-button" onClick={() => void submitComponentAnswer()} disabled={!componentDraft.trim() || componentSubmitting}>{componentSubmitting ? "Sending…" : "Send answer ↗"}</button></div></div>}
            </div>)}
          </div>
          <div className="canvas-controls" onPointerDown={(event) => event.stopPropagation()}><button type="button" className="canvas-control" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">−</button><span className="canvas-zoom">{Math.round(view.zoom * 100)}%</span><button type="button" className="canvas-control" onClick={() => zoomBy(1.2)} aria-label="Zoom in">＋</button><button type="button" className="canvas-control" onClick={() => fitViewTo(architecture.nodes)} aria-label="Fit design to view">Fit</button></div>
        </div>
      </section>
      <aside className="interview-sidebar">
        <div className={`ai-orb-dock ai-${aiState}`}>
          <div className="interview-guide"><div><span className="eyebrow">Interview map</span><strong>{interviewState.phase.replaceAll("_", " ")}</strong></div><span>{Math.min(interviewState.answers.length + 1, interviewPhases.length)} / {interviewPhases.length}</span></div>
          <div className="interview-progress" aria-label="Interview progress"><span style={{ width: `${Math.min(100, ((interviewPhases.indexOf(interviewState.phase) + 1) / interviewPhases.length) * 100)}%` }} /></div>
          {interviewState.scenarioDescription && <p className="scenario-brief">{interviewState.scenarioDescription}</p>}
          <div className="ai-caption-stack" aria-live="polite" aria-atomic="false">{isListening && <div className="live-caption live-caption-listening" role="status"><span>Listening…</span>{voiceTranscript || "Speak now — your words go straight to the interviewer."}</div>}{!isListening && voiceTranscript && <div className="live-caption user-caption"><span>You</span>{voiceTranscript}</div>}<div className="live-caption ai-caption"><span>Blueprint / {interviewState.phase.replaceAll("_", " ")}</span>{question}</div></div>
          <div className="ai-orb-row"><button className="ai-orb-button" aria-label={`AI interviewer ${aiState}`} onClick={() => setVoiceEnabled((enabled) => !enabled)}><span className="ai-orb-core">✦</span></button><span className="ai-state-label">{aiStateLabel}</span><select aria-label="Interviewer voice" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} className="voice-picker">
            <option value="en-US-AriaNeural">Aria · US</option>
            <option value="en-US-JennyNeural">Jenny · US</option>
            <option value="en-US-EmmaNeural">Emma · US</option>
            <option value="en-US-AvaNeural">Ava · US</option>
            <option value="en-US-GuyNeural">Guy · US</option>
            <option value="en-US-AndrewNeural">Andrew · US</option>
            <option value="en-US-BrianNeural">Brian · US</option>
            <option value="en-GB-SoniaNeural">Sonia · UK</option>
            <option value="en-GB-RyanNeural">Ryan · UK</option>
            <option value="en-IN-NeerjaNeural">Neerja · IN</option>
            <option value="en-IN-PrabhatNeural">Prabhat · IN</option>
          </select></div>
          <div className="voice-dock">
            <button className={`voice-talk ${isListening ? "talking" : ""}`} onClick={isListening ? () => void stopListening() : () => void startListening()} disabled={isSubmittingTurn || isTranscribing || interviewEnded} aria-label={isListening ? "Stop listening and send your answer" : "Start speaking with the interviewer"}>{isListening ? <><span aria-hidden="true">■</span> Stop — send answer</> : isTranscribing ? "Transcribing…" : <><span aria-hidden="true">◉</span> Answer by voice</>}</button>
            <span className="voice-hint">{timeLimitReached ? "You reached the 40-minute limit — your architecture and critique are ready in the scorecard." : micStatus || (interviewEnded ? "The interview has ended — open your scorecard to review it." : isListening ? "Speak naturally — every word is captioned live below." : micPermission === "granted" ? "Tap to answer by voice — it transcribes on your device, free and offline after the first use." : "Voice needs one-time browser permission; tap the mic and allow it.")}</span>
          </div>
          {whisperModelState === "loading" && <p className="mic-status" style={{ color: "var(--muted)" }}>Preparing the offline speech model in the background… it&apos;ll be ready when you are.</p>}
          <div className="dock-controls">{interviewEnded ? <button className="text-link" onClick={() => setShowScorecard(true)}>View scorecard</button> : <button className="text-link" onClick={() => setShowEndConfirm(true)}>End interview</button>}</div>
          {showScorecard && evaluationReport && <div className="transcript-modal" role="dialog" aria-modal="true" aria-label="Interview scorecard"><div className="transcript-card scorecard-modal-card"><section className="evaluation-card" aria-live="polite"><div className="eyebrow">Evidence-based review</div><strong className="evaluation-score">{evaluationReport.score}/100</strong><p className="evaluation-note">Weighted evidence score: 70% answer evidence, 30% architecture health, scaled by how many design phases you actually addressed. Levels use fixed anchors and quoted transcript excerpts, never personality or speaking style.</p>{evaluationDiagram && <figure className="scorecard-diagram">{/* eslint-disable-next-line @next/next/no-img-element */}
<img src={evaluationDiagram} alt={`Architecture diagram for ${scenarioName}`} />
<figcaption>{scenarioName} · architecture at the end of the interview</figcaption></figure>}{evaluationReport.critique && <div className="critique-block"><div className="eyebrow">Staff-engineer critique</div><p className="critique-summary">{evaluationReport.critique.summary}</p>{evaluationReport.critique.strengths.length > 0 && <><strong className="critique-label">What held up</strong><ul>{evaluationReport.critique.strengths.map((item, index) => <li key={`strength-${index}`}>{item}</li>)}</ul></>}{evaluationReport.critique.improvements.length > 0 && <><strong className="critique-label">What to fix</strong><ul>{evaluationReport.critique.improvements.map((item, index) => <li key={`improve-${index}`}>{item}</li>)}</ul></>}</div>}<div className="scorecard-title-row"><strong>End-of-interview scorecard</strong><span>{evaluationReport.scorecard.answersAssessed} answers assessed</span></div><div className="scorecard-list">{evaluationReport.scorecard.competencies.map((item) => <div className="scorecard-row" key={item.id}><div className="scorecard-row-head"><strong>{item.name}</strong><span className={`level-chip ${item.level ? `level-${item.level}` : "level-unassessed"}`}>{item.level ? `${item.level} · ${item.label}` : "Not assessed"}</span><span className="scorecard-num">{item.score !== null ? `${item.score}/100` : "–"}</span></div><p className="scorecard-evidence">{item.evidence}</p>{item.quotes.map((quote, index) => <blockquote className="scorecard-quote" key={`${item.id}-${index}`}>&quot;{quote.text}&quot; <cite>{quote.phase}</cite></blockquote>)}</div>)}</div><p className="scorecard-summary">{evaluationReport.scorecard.overall.summary}</p><details className="level-scale"><summary>How levels are calibrated</summary><ol>{evaluationReport.scorecard.scale.map((level) => <li key={level.level}><strong>{level.level} · {level.label}</strong><span>{level.anchor}</span></li>)}</ol></details>{evaluationReport.improvements.length > 0 && <div className="evaluation-improvements"><strong>{evaluationReport.improvements.length > 1 ? "Next practice targets" : "Next practice target"}</strong><ul>{evaluationReport.improvements.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}</ul></div>}<button className="primary-button" style={{ marginTop: 14 }} onClick={() => void downloadTranscript()}>Download interview doc</button><button className="tool-button" style={{ marginTop: 8 }} onClick={() => setShowScorecard(false)}>Close</button></section></div></div>}
        </div>
      </aside>
      {showEndConfirm && <div className="transcript-modal" role="dialog" aria-modal="true" aria-label="End interview confirmation"><div className="transcript-card"><button className="popover-close" onClick={() => setShowEndConfirm(false)} aria-label="Close confirmation">×</button><div className="eyebrow">End interview</div><h2 style={{ margin: "8px 0 12px", fontSize: 24 }}>Ready to see your scorecard?</h2><p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: "0 0 20px" }}>You&apos;ve answered {interviewState.answers.length} question{interviewState.answers.length === 1 ? "" : "s"} so far. Ending the interview will generate your final evaluation based on your architecture and answers.</p><div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><button className="tool-button" onClick={() => setShowEndConfirm(false)}>Keep practicing</button><button className="primary-button" onClick={endInterview}>End and evaluate ↗</button></div></div></div>}
      {showScorecard && !evaluationReport && <div className="transcript-modal" role="dialog" aria-modal="true" aria-label="Generating scorecard"><div className="transcript-card scorecard-modal-card"><button className="popover-close" onClick={() => setShowScorecard(false)} aria-label="Close scorecard">×</button><div className="eyebrow">End of interview</div><h2 style={{ margin: "8px 0 12px", fontSize: 24 }}>{isEvaluating ? "Building your scorecard…" : "We could not build your scorecard"}</h2><p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.6, margin: 0 }}>{isEvaluating ? "Scoring your architecture and the evidence from your answers. This takes a few seconds." : "Something went wrong while generating the evaluation. Close this and try ending the interview again."}</p></div></div>}
      {selectedNode && showEditTools && <div className="edit-popover" onPointerDown={(event) => event.stopPropagation()}><div className="eyebrow">Edit component</div><label className="field-label" htmlFor="node-label">Label</label><input id="node-label" className="editor-input" value={selectedNode.label} onChange={(event) => updateNode({ label: event.target.value })} /><div className="editor-row"><div><label className="field-label" htmlFor="node-provider">Provider</label><select id="node-provider" className="editor-input" value={selectedNode.provider || ""} onChange={(event) => updateNode({ provider: event.target.value || undefined })}><option value="">Inherit / none</option>{ARCHITECTURE_PROVIDERS.map((provider) => <option key={provider} value={provider}>{architectureProviderLabel(provider)}</option>)}</select></div><div><label className="field-label" htmlFor="node-zone">Zone</label><input id="node-zone" className="editor-input" value={(architecture.zones || []).find((zone) => zone.id === selectedNode.zone)?.label || "Not in a zone"} readOnly /></div></div><div className="editor-row"><div><label className="field-label" htmlFor="node-replicas">Replicas</label><input id="node-replicas" type="number" min={0} className="editor-input" value={selectedNode.replicas ?? ""} onChange={(event) => updateNode({ replicas: event.target.value === "" ? undefined : Math.max(0, Math.floor(Number(event.target.value))) })} /></div><div><label className="field-label" htmlFor="node-shards">Shards</label><input id="node-shards" type="number" min={0} className="editor-input" value={selectedNode.shards ?? ""} onChange={(event) => updateNode({ shards: event.target.value === "" ? undefined : Math.max(0, Math.floor(Number(event.target.value))) })} /></div></div><label className="field-label" htmlFor="node-note">Notes</label><textarea id="node-note" className="editor-textarea small-textarea" value={selectedNode.note} onChange={(event) => updateNode({ note: event.target.value })} /></div>}
    </div>
  </main>;
}
