"use client";

import Link from "next/link";
import { useState } from "react";
import { loadLocalHistory, removeLocalHistoryItem, clearLocalHistory, snapshotKeyFor, type LocalHistoryItem } from "../../lib/local-history";
import type { ArchitectureState } from "../../lib/architecture";
import type { InterviewState } from "../../lib/interview";
import { validateArchitecture } from "../../lib/architecture-validator";
import { architecturePNGDataURL, buildTranscriptDoc } from "../../lib/transcript";

type Snapshot = {
  scenario: string;
  difficulty: string;
  architecture: ArchitectureState;
  state: InterviewState;
  savedAt: number;
};

const readSnapshot = (run: string): Snapshot | null => {
  try {
    const raw = window.localStorage.getItem(snapshotKeyFor(run));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
};

export default function HistoryPage() {
  const [items, setItems] = useState<LocalHistoryItem[]>(() => loadLocalHistory());
  const [downloadState, setDownloadState] = useState<Record<string, "idle" | "working" | "missing" | "error">>({});

  const downloadDoc = async (item: LocalHistoryItem) => {
    const snapshot = readSnapshot(item.run);
    if (!snapshot) {
      setDownloadState((current) => ({ ...current, [item.id]: "missing" }));
      return;
    }
    setDownloadState((current) => ({ ...current, [item.id]: "working" }));
    try {
      const validation = validateArchitecture(snapshot.architecture);
      let imageDataURL = "";
      try {
        imageDataURL = await architecturePNGDataURL(snapshot.architecture);
      } catch {
        // The image is optional; the document still renders without it.
      }
      const doc = buildTranscriptDoc({
        scenario: snapshot.scenario || item.scenario,
        difficulty: snapshot.difficulty || item.difficulty,
        completedAt: item.completedAt,
        architecture: snapshot.architecture,
        validation,
        interviewState: snapshot.state,
        imageDataURL,
      });
      const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${item.scenario.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-interview-${item.completedAt.slice(0, 10)}.html`;
      link.click();
      URL.revokeObjectURL(url);
      setDownloadState((current) => ({ ...current, [item.id]: "idle" }));
    } catch {
      setDownloadState((current) => ({ ...current, [item.id]: "error" }));
    }
  };

  const removeItem = (id: string) => {
    const remaining = removeLocalHistoryItem(id);
    setItems(remaining);
  };

  const clearAll = () => {
    setItems(clearLocalHistory());
  };

  return <main className="shell content-page"><nav className="nav"><Link href="/" className="brand"><span className="brand-mark">B</span> blueprint</Link><div className="nav-links"><Link href="/">Home</Link><Link href="/scenarios" className="text-link">New interview ↗</Link></div></nav><section className="section"><div className="eyebrow">Your interviews</div><h1>Interview history.</h1><p className="lede">Finished interviews are stored only on this device. Re-download any recent interview document — the transcript, architecture diagram, and scoring breakdown travel with you, and nothing is kept on a server.</p>{items.length === 0 && <p className="empty-state">No completed interviews on this device yet. Finishing an interview produces a downloadable document that is listed here.</p>}<div className="history-list">{items.map((item) => <article className="history-card" key={item.id}><div><div className="eyebrow">{item.difficulty} · completed · {item.architectureHealth}/100 architecture · {item.evaluationScore}/100 evaluation</div><h2>{item.scenario}</h2><p>Completed {new Date(item.completedAt).toLocaleString()}</p>{downloadState[item.id] === "missing" && <p className="empty-state">The live snapshot for this interview was pruned, so the document can no longer be rebuilt. Export it from the interview next time.</p>}{downloadState[item.id] === "error" && <p className="empty-state">Could not build the document — try again.</p>}</div><div style={{ display: "flex", gap: 8, alignItems: "center" }}><Link className="tool-button" href={`/interview?scenario=${encodeURIComponent(item.scenario)}&run=${item.run}`}>Open ↗</Link><button className="tool-button" onClick={() => void downloadDoc(item)} disabled={downloadState[item.id] === "working"}>{downloadState[item.id] === "working" ? "Building…" : "Download doc"}</button><button className="tool-button" onClick={() => removeItem(item.id)} aria-label={`Delete ${item.scenario} from local history`}>Delete</button></div></article>)}</div>{items.length > 1 && <button className="tool-button" style={{ marginTop: 16 }} onClick={clearAll}>Clear local history</button>}</section></main>;
}