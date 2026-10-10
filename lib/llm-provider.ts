import type { InterviewContext, InterviewTurn } from "./interview";
import { interviewPhases, isInterviewTurn, MAX_TURNS_PER_PHASE } from "./interview";

export interface LLMProvider {
  generateInterviewTurn(context: InterviewContext): Promise<InterviewTurn>;
}

const fallbackTurn: InterviewTurn = {
  action: "transition_phase",
  message: "Good. You've established the core operations. Now let's estimate the workload so our architecture has numbers behind it. Roughly how many creates and redirects would you expect per day?",
  question: "Good. You've established the core operations. Now let's estimate the workload so our architecture has numbers behind it. Roughly how many creates and redirects would you expect per day?",
  reason: "Acknowledge the requirements before moving into an explicit capacity estimate.",
  topic: "scale_estimation",
  difficultyAdjustment: "hold",
  followUpType: "scale",
  evaluation: { correctness: 0.6, depth: 0.5, tradeoffAwareness: 0.5 },
};

function guidedTurn(
  message: string,
  question: string,
  topic: string,
  followUpType: InterviewTurn["followUpType"],
  action: InterviewTurn["action"] = "follow_up",
  nextPhase?: InterviewTurn["nextPhase"],
): InterviewTurn {
  return {
    action,
    message,
    question,
    reason: "Keep the candidate focused on one decision and make the next reasoning step explicit.",
    topic,
    nextPhase,
    difficultyAdjustment: "hold",
    followUpType,
    evaluation: { correctness: 0.6, depth: 0.5, tradeoffAwareness: 0.5 },
  };
}

class MockLLMProvider implements LLMProvider {
  async generateInterviewTurn(context: InterviewContext): Promise<InterviewTurn> {
    const answer = context.answer.trim().toLowerCase();

    // Replication, sharding, and replica counts are configuration, not a quiz
    // topic. When the candidate commits to enabling them in a sentence or two,
    // accept it immediately instead of drilling into the topology.
    const configCommitment = /(\benabl(e|ing)\b|\bturn(ed)?\s+on\b|\bset\s+up\b|\bjust\s+add(ed)?\b|\bgo(ing)?\s+with\b|\buse\b).{0,60}(replicat|shard|replication)/i.test(answer)
      && answer.length < 160;
    const settledBriefAnswer = /^(yes|yeah|yep|sure|ok|okay|done|we('| a)?ll|i('| a)?ll|just)\b/i.test(answer.trim())
      && /(replicat|shard|replication)/i.test(answer);
    if (configCommitment || settledBriefAnswer) {
      return guidedTurn(
        "Understood — read replicas, sharding, and zones are configuration switches, and you've committed to turning them on. That's a settled decision; I won't interrogate the exact topology unless a later trade-off depends on it.",
        "Good. Continue from that settled choice — what part of the design should we harden next?",
        context.state.phase,
        context.state.phase === "scalability" ? "scale" : "tradeoff",
      );
    }

    if (/^(hello|hi|hey)\b/.test(answer) || answer.includes("can you hear")) {
      return guidedTurn(
        "I can hear you — we're live, so just speak naturally. The canvas starts with a single client for this scenario; everything else is yours to build. Start with the user journey before we discuss technologies.",
        `What are the two most important operations this ${context.state.scenario} system must support?`,
        "requirements",
        "clarification",
      );
    }
    if (/\b(no idea|i don't know|dont know|sorry|not sure)\b/.test(answer)) {
      const prompt = context.state.phase === "scale_estimation"
        ? "That's okay. Use a relative estimate instead of an exact number — if one user acts, how many others act as a result? Rough order of magnitude is fine."
        : context.state.phase === "high_level_architecture"
          ? "No problem. Trace one request with me: which component receives it first, and where does the durable state live? You can draw it on the canvas as you go."
          : "That's okay. Let's narrow the decision. What is the single most important user action this system must make reliable, and which component on your canvas owns it?";
      return guidedTurn(prompt, prompt, context.state.phase, "clarification");
    }
    // A canvas observation is not an answer. Name the edit the candidate just
    // made before falling back to the deterministic "broken path" challenge —
    // otherwise adding a first component can never be acknowledged, because the
    // starter canvas already has an unconnected entry point.
    if (!context.observation && context.architectureValidation.findings.some((finding) => finding.severity === "error")) {
      return {
        ...fallbackTurn,
        action: "component_challenge",
        message: "I see a broken critical path in the current design. Let's slow down and examine that assumption. Which connection is invalid, and how would you repair it before discussing scale?",
        question: "I see a broken critical path in the current design. Let's slow down and examine that assumption. Which connection is invalid, and how would you repair it before discussing scale?",
        reason: "Resolve deterministic architecture errors before adding complexity.",
        topic: "high_level_architecture",
        followUpType: "clarification",
      };
    }
    // The candidate just edited the canvas — challenge exactly that change
    // (whether it was a component or a connection, an addition or a removal).
    const addedComponents = context.architectureChanges.added;
    const addedConnections = context.architectureChanges.addedConnections;
    const removedComponents = context.architectureChanges.removed;
    const removedConnections = context.architectureChanges.removedConnections;
    if (addedComponents.length > 0 || addedConnections.length > 0) {
      const what = addedComponents.length > 0 ? `added ${addedComponents.join(", ")}` : `connected ${addedConnections.join(", ")}`;
      return {
        ...fallbackTurn,
        action: "component_challenge",
        message: `I see you ${what} on the canvas — good instinct. What responsibility does that take on, and why is that the right split for this workload?`,
        question: addedComponents.length > 0
          ? `Explain the role of ${addedComponents[0]} in the request path and the trade-off it introduces.`
          : `Walk me through what flows across ${addedConnections[0]} and why that link is needed.`,
        reason: "Engage architecture edits the moment they are made.",
        topic: "high_level_architecture",
        nextPhase: "high_level_architecture",
        followUpType: "tradeoff",
      };
    }
    if (removedComponents.length > 0 || removedConnections.length > 0) {
      const what = removedComponents.length > 0 ? `removed ${removedComponents.join(", ")}` : `disconnected ${removedConnections.join(", ")}`;
      return {
        ...fallbackTurn,
        action: "component_challenge",
        message: `I notice you ${what}. What does the design lose without it, and how will the system keep that responsibility covered?`,
        question: `What breaks in the request path now that ${removedComponents[0] || removedConnections[0]} is gone, and how do you cover it?`,
        reason: "Treat every canvas edit, including deletions, as a design decision.",
        topic: "reliability",
        followUpType: "failure_mode",
      };
    }
    if (context.state.phase === "production_incident") {
      return {
        ...fallbackTurn,
        action: "incident",
        message: "Let's introduce a production scenario. Traffic has increased 5× and API latency is now 3 seconds. You're on call. What would you investigate first, and what is your safest mitigation?",
        question: "Let's introduce a production scenario. Traffic has increased 5× and API latency is now 3 seconds. You're on call. What would you investigate first, and what is your safest mitigation?",
        reason: "Test diagnosis, mitigation, and recovery under pressure.",
        topic: "reliability",
        followUpType: "incident",
      };
    }
    if (context.state.phase === "requirements") {
      return guidedTurn(
        "Good start — that pins down the user journey. Now let's make the design measurable before choosing components.",
        "What traffic pattern should we design for: approximate creates and reads per day, and which operation is the read-heavy path?",
        "scale_estimation",
        "scale",
        "transition_phase",
        "scale_estimation",
      );
    }
    if (context.state.phase === "scale_estimation") {
      return guidedTurn(
        "That gives us a useful workload shape. Let's turn it into a request path on the canvas and keep the first version simple.",
        "Walk me through the critical path for the most frequent request. Where does state live, and which component owns the decision?",
        "high_level_architecture",
        "clarification",
        "transition_phase",
        "high_level_architecture",
      );
    }
    if (context.state.phase === "high_level_architecture") {
      return guidedTurn(
        "I can see the main path now. Before we add complexity, let's make the service boundary testable.",
        "What API contract would you expose for the primary operation, and what would the client need to know?",
        "api_design",
        "tradeoff",
        "transition_phase",
        "api_design",
      );
    }
    if (context.state.phase === "api_design") {
      return guidedTurn(
        "Good. That contract gives us a stable boundary. Now let's examine the data behind it.",
        "What data must be stored durably, and which lookup or consistency constraint matters most?",
        "data_model",
        "tradeoff",
        "transition_phase",
        "data_model",
      );
    }
    if (context.state.phase === "data_model") {
      return guidedTurn(
        "You've identified the durable state. Now compare the simplest storage choice against the workload you estimated.",
        "Would you choose a relational database, a key-value store, or both? What trade-off makes your choice appropriate here?",
        "database_selection",
        "tradeoff",
        "transition_phase",
        "database_selection",
      );
    }
    if (context.state.phase === "database_selection") {
      return guidedTurn(
        "That is a reasonable storage boundary. Let's focus on latency without hiding consistency costs.",
        "Where would caching help most, what would the cache key be, and how would you handle stale data?",
        "caching",
        "tradeoff",
        "transition_phase",
        "caching",
      );
    }
    if (context.state.phase === "caching") {
      return guidedTurn(
        "Now we have a latency strategy. Let's pressure-test the design with asynchronous work.",
        "Which work can leave the synchronous request path, and what happens if the queue or consumer is unavailable?",
        "async_processing",
        "failure_mode",
        "transition_phase",
        "async_processing",
      );
    }
    if (context.state.phase === "async_processing") {
      return guidedTurn(
        "Good. You've separated the synchronous and asynchronous paths. Now let's make sure the system can grow horizontally.",
        "Which components in your design can scale independently, and what breaks first when you double the traffic?",
        "scalability",
        "scale",
        "transition_phase",
        "scalability",
      );
    }
    if (context.state.phase === "scalability") {
      return guidedTurn(
        "That gives us a scaling story — and replicas or sharding are yours to switch on. Now let's make sure the system fails gracefully.",
        "What happens when your primary database becomes unavailable? How does the user experience change, and what recovers first?",
        "reliability",
        "failure_mode",
        "transition_phase",
        "reliability",
      );
    }
    if (context.state.phase === "reliability") {
      return guidedTurn(
        "Good thinking on failure modes. Let's now consider who can access what.",
        "How do you authenticate requests between services, and how do you authorize access to sensitive data?",
        "security",
        "tradeoff",
        "transition_phase",
        "security",
      );
    }
    if (context.state.phase === "security") {
      return guidedTurn(
        "That covers the trust boundaries. Now let's make sure you can see what's happening in production.",
        "What metrics, logs, and traces would you use to detect a partial failure before users report it?",
        "observability",
        "clarification",
        "transition_phase",
        "observability",
      );
    }
    if (context.state.phase === "observability") {
      return guidedTurn(
        "Good. You have a full operational picture. Let's now test everything you've built under real pressure.",
        "Traffic is now 5× higher than forecast and the primary database is at 90% capacity. What fails first?",
        "production_incident",
        "incident",
        "transition_phase",
        "production_incident",
      );
    }
    if ((context.state.phase as string) === "production_incident") {
      return {
        ...fallbackTurn,
        action: "incident",
        message: "The incident is contained. You've walked through requirements, architecture, data, scaling, reliability, security, and observability. I have enough to evaluate your design. Let me put together your scorecard.",
        question: "The incident is contained. You've walked through requirements, architecture, data, scaling, reliability, security, and observability. I have enough to evaluate your design. Let me put together your scorecard.",
        reason: "Close the interview loop and transition to evaluation.",
        topic: "final_evaluation",
        followUpType: "incident",
        nextPhase: "final_evaluation",
      };
    }
    return {
      ...fallbackTurn,
      message: "Let's keep the discussion grounded in your design. Pick one component or connection and explain the trade-off it introduces.",
      question: "Which part of your current architecture would you change first as traffic grows, and why?",
      action: "follow_up",
      topic: context.state.phase,
      followUpType: "tradeoff",
    };
  }
}

/**
 * Compact, readable rendering of the full interview context for an LLM. The
 * raw state is a large object; the model reasons better when it is given the
 * scenario brief, the live canvas, and the recent conversational evidence.
 */
function buildPromptPayload(context: InterviewContext): Record<string, unknown> {
  const { state, answer, architectureValidation, architectureChanges } = context;
  const snapshot = state.architectureSnapshot;
  return {
    scenario: state.scenario,
    scenarioDescription: state.scenarioDescription,
    difficulty: state.difficulty,
    phase: state.phase,
    conversationMode: state.conversationMode,
    currentQuestion: state.currentQuestion,
    questionsAlreadyAsked: state.questionsAsked.slice(-8),
    recentDecisions: state.previousDecisions.slice(-4),
    recentAnswers: state.answers.slice(-6).map((item) => ({
      question: item.question,
      answer: item.answer,
      phase: item.phase,
      score: item.score,
    })),
    architecture: {
      nodeCount: snapshot.nodes.length,
      nodes: snapshot.nodes.map((node) => ({
        label: node.label,
        type: node.type,
        provider: node.provider || null,
        zone: node.zone || null,
        replicas: node.replicas || 1,
        shards: node.shards || 1,
      })),
      connections: snapshot.edges.map((edge) => {
        const source = snapshot.nodes.find((node) => node.id === edge.source)?.label || edge.source;
        const target = snapshot.nodes.find((node) => node.id === edge.target)?.label || edge.target;
        return `${source} -> ${target}${edge.label ? ` (${edge.label})` : ""}`;
      }),
      zones: (snapshot.zones || []).map((zone) => `${zone.label}${zone.provider ? ` (${zone.provider})` : ""}`),
    },
    architectureChanges,
    observation: context.observation === true,
    pacing: {
      turnsInPhase: context.turnsInPhase,
      maxTurnsInPhase: context.maxTurnsInPhase,
      phaseOrder: [...interviewPhases],
    },
    validation: {
      score: architectureValidation.score,
      valid: architectureValidation.valid,
      findings: architectureValidation.findings.map((finding) => `${finding.severity}: ${finding.title} — ${finding.detail}`),
    },
    candidateAnswer: answer,
  };
}

const INTERVIEWER_SYSTEM_PROMPT = `You are a senior staff engineer and a demanding but fair system-design interviewer running a live, voice-first interview. The candidate speaks their answers and builds a system diagram on a canvas as they talk. You must help them turn a nearly empty canvas into a defensible architecture, one decision at a time.

Conversational style
- Never sound like a multiple-choice questionnaire. Never say "next question". Never reveal an "ideal" architecture. Never grade out loud.
- Always open by acknowledging something specific the candidate just said (their words, their numbers, or the component they added), then engage exactly ONE decision that deserves scrutiny, then ask exactly ONE focused follow-up question.
- Keep turns short: a sentence or two of acknowledgment plus one question. You are heard aloud (text-to-speech), so write for the ear, not the page.
- Never repeat a question, and never re-ask a lightly reworded version of one you already asked — the payload's questionsAlreadyAsked lists them, and currentQuestion is the one you just asked. If the candidate answered but did not fully satisfy you, ask a genuinely different follow-up that probes a new angle, or close the topic and move on. Re-asking the same question is never acceptable.

Working with the canvas
- The candidate starts with a single client component and builds everything else. When architectureChanges lists components or connections, challenge exactly that change: "You added an upload service — what responsibility does it take on, and why is that the right split?" architectureChanges.added/removed are components; addedConnections/removedConnections are links like "API Server -> Redis".
- Observation mode: when the payload has observation set to true, the candidate just edited the canvas and has NOT spoken. Open by naming the exact change (the component or connection you see added or removed) as if you watched them draw it, then ask one question about that change. Do not thank them for an answer they did not give.
- Replication, sharding, replica counts, and zone placement are configuration, not a quiz topic. If the candidate says they will enable replication, sharding, or replicas and treats it as a settled choice, accept it instantly — a short "we'll enable it" is a complete, correct decision. Only revisit the exact topology if a later trade-off genuinely depends on it.
- Observation mode takes precedence: when observation is true, name and question the change you watched, even if validation simultaneously reports a blocking error. The candidate has not answered yet, so a generic "your design is broken" reaction reads as if you ignored them.
- If validation lists blocking errors, address the most severe finding before opening a new topic.

Progression and difficulty
- Cover the phases in order: requirements, scale_estimation, high_level_architecture, api_design, data_model, database_selection, caching, async_processing, scalability, reliability, security, observability, production_incident, final_evaluation.
- Do not get stuck on one technology or subsystem. The payload reports pacing.turnsInPhase and pacing.maxTurnsInPhase (currently ${MAX_TURNS_PER_PHASE}). Once turnsInPhase reaches maxTurnsInPhase, close the topic on this turn: set action to transition_phase and nextPhase to the next phase in pacing.phaseOrder, even if you could probe further. Breadth beats depth — the candidate must show they can reason about the whole system, not one component.
- You may deliberately revisit an earlier phase later if a new decision creates a real dependency (set nextPhase back to that phase), but a revisit must be brief and purposeful, never a loop back into the same topic.
- Transition to the next phase once the current topic is satisfactorily closed. Expert and hard interviews demand concrete mechanisms, alternatives, and failure modes; easy and medium interviews accept clearer, simpler answers.

Scoring (silent, applied to the candidate's just-given answer)
- correctness, 0..1: matches the requirements, the estimated scale, and sound engineering. 0 = wrong or self-contradictory, 0.5 = plausible but imprecise, 1 = accurate and specific.
- depth, 0..1: names concrete mechanisms, numbers, or failure modes. 0 = vague buzzwords, 0.5 = one concrete detail, 1 = layered, quantified reasoning.
- tradeoffAwareness, 0..1: considers alternatives, downsides, or failure modes. 0 = none, 0.5 = one named trade-off, 1 = compares alternatives against constraints.
Never inflate scores for length or confidence; reward specificity and judgment.

Return ONLY valid JSON with EXACTLY these keys and no others: action (one of: acknowledge, follow_up, transition_phase, component_challenge, incident, evaluation), message (string: the complete conversational reply including the acknowledgment and the single question), question (string: just the question), reason (string: your reasoning for this turn), topic (string), nextPhase (optional string), difficultyAdjustment (exactly one of: increase, decrease, hold), followUpType (exactly one of: clarification, tradeoff, failure_mode, scale, incident), evaluation (object with numeric correctness, depth, tradeoffAwareness, each 0 to 1). nextPhase is the only key that may be absent.`;

class OpenAICompatibleProvider implements LLMProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(endpoint: string, apiKey: string, model: string) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.model = model;
  }

  async generateInterviewTurn(context: InterviewContext): Promise<InterviewTurn> {
    const startTime = Date.now();
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: INTERVIEWER_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(buildPromptPayload(context)) },
        ],
      }),
    });
    const latencyMs = Date.now() - startTime;
    if (typeof process !== "undefined" && process.env.LLM_LATENCY_THRESHOLD_MS) {
      const threshold = Number(process.env.LLM_LATENCY_THRESHOLD_MS);
      if (Number.isFinite(threshold) && latencyMs > threshold) {
        const { recordLLMLatency } = await import("./monitoring");
        recordLLMLatency(latencyMs, threshold);
      }
    }
    if (!response.ok) throw new Error(`LLM provider returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string; reasoning?: string } }> };
    const rawContent = payload.choices?.[0]?.message?.content;
    // Some reasoning models return the visible answer in content and may leave it
    // empty while the transcript carries everything; fall back gracefully.
    const content = rawContent && rawContent.trim() ? rawContent : payload.choices?.[0]?.message?.reasoning || "";
    if (!content) throw new Error("LLM provider returned no message content");
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new Error("LLM provider returned non-JSON content");
    }
    // Reasoning models sometimes omit optional conversation keys or return
    // invalid enum values. Normalize before strict validation so one missing
    // field does not kill the interview turn.
    let parsed: unknown;
    if (raw && typeof raw === "object") {
      const turn = raw as Record<string, unknown>;
      const validActions = ["acknowledge", "follow_up", "transition_phase", "component_challenge", "incident", "evaluation"];
      const validFollowUpTypes = ["clarification", "tradeoff", "failure_mode", "scale", "incident"];
      const validDifficulty = ["increase", "decrease", "hold"];
      const message = typeof turn.message === "string" && turn.message.trim() ? turn.message : typeof turn.question === "string" ? turn.question : "";
      const question = typeof turn.question === "string" && turn.question.trim() ? turn.question : message;
      parsed = {
        action: validActions.includes(turn.action as string) ? turn.action : "follow_up",
        message,
        question,
        reason: typeof turn.reason === "string" && turn.reason ? turn.reason : question,
        topic: typeof turn.topic === "string" && turn.topic ? turn.topic : "requirements",
        difficultyAdjustment: validDifficulty.includes(turn.difficultyAdjustment as string) ? turn.difficultyAdjustment : "hold",
        followUpType: validFollowUpTypes.includes(turn.followUpType as string) ? turn.followUpType : "clarification",
        ...(typeof turn.nextPhase === "string" && (interviewPhases as readonly string[]).includes(turn.nextPhase) ? { nextPhase: turn.nextPhase as InterviewTurn["nextPhase"] } : {}),
        evaluation: (turn.evaluation && typeof turn.evaluation === "object"
          ? {
              correctness: Number((turn.evaluation as Record<string, unknown>).correctness) || 0.6,
              depth: Number((turn.evaluation as Record<string, unknown>).depth) || 0.5,
              tradeoffAwareness: Number((turn.evaluation as Record<string, unknown>).tradeoffAwareness) || 0.5,
            }
          : { correctness: 0.6, depth: 0.5, tradeoffAwareness: 0.5 }),
      };
    }
    if (!isInterviewTurn(parsed)) throw new Error("LLM provider returned an invalid interview turn");
    return parsed as InterviewTurn;
  }
}

export function getLLMProvider(): LLMProvider {
  const provider = process.env.LLM_PROVIDER || "mock";
  if (provider === "mock") return new MockLLMProvider();
  const endpoint = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY || "";
  if (!model) throw new Error("LLM_MODEL is required for the configured provider");
  if (provider === "ollama") {
    return new OpenAICompatibleProvider(endpoint || "http://127.0.0.1:11434/v1", apiKey, model);
  }
  if (provider === "qwen") {
    return new OpenAICompatibleProvider(endpoint || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", apiKey, model);
  }
  if (!endpoint || !apiKey) throw new Error("LLM_BASE_URL and LLM_API_KEY are required for the configured provider");
  return new OpenAICompatibleProvider(endpoint, apiKey, model);
}
