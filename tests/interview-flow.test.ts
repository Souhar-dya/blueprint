import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyInterviewTurn,
  applyObservationTurn,
  buildInterviewContext,
  createInterviewState,
  interviewPhases,
  isDuplicateQuestion,
  isInterviewTurn,
  MAX_TURNS_PER_PHASE,
  phaseTransitionQuestion,
  turnsInCurrentPhase,
  type InterviewState,
  type InterviewTurn,
} from "../lib/interview";
import { getLLMProvider, type LLMProvider } from "../lib/llm-provider";
import { buildEvaluationReport } from "../lib/evaluation";
import { validateArchitecture } from "../lib/architecture-validator";
import { scenarioBriefFor, starterArchitectureFor } from "../lib/prebuilt-architectures";
import type { ArchitectureState } from "../lib/architecture";

const architecture: ArchitectureState = {
  nodes: [
    { id: "client", type: "client", label: "Web Client", x: 0, y: 0, reasoning: "entry point", note: "" },
    { id: "api", type: "compute", label: "API Server", x: 10, y: 10, reasoning: "handles requests", note: "" },
    { id: "db", type: "database", label: "PostgreSQL", x: 20, y: 20, reasoning: "durable state", note: "" },
  ],
  edges: [
    { id: "e1", source: "client", target: "api", label: "HTTPS" },
    { id: "e2", source: "api", target: "db", label: "SQL" },
  ],
};

/**
 * A neutral answer that dodges every special MockLLMProvider branch (greeting,
 * "I don't know", and the replication/sharding configuration commitment), so it
 * always produces the ordinary phase-by-phase progression.
 */
const neutralAnswer = "The design stores user records in a relational database and serves reads through an in-memory cache at the edge.";

const turnFixture = (overrides: Partial<InterviewTurn> = {}): InterviewTurn => ({
  action: "follow_up",
  message: "Tell me more about that decision.",
  question: "Tell me more about that decision?",
  reason: "Probe the decision before moving on.",
  topic: "requirements",
  difficultyAdjustment: "hold",
  followUpType: "clarification",
  evaluation: { correctness: 0.7, depth: 0.6, tradeoffAwareness: 0.5 },
  ...overrides,
});

let originalProvider: string | undefined;
beforeEach(() => {
  originalProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "mock";
});
afterEach(() => {
  if (originalProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = originalProvider;
});

/**
 * Runs a full interview against the mock provider until it reaches the closing
 * phase, returning the final state and every phase visited along the way.
 */
async function runFullInterview(provider: LLMProvider, start: InterviewState) {
  let state = start;
  const visited: string[] = [state.phase];
  let guard = 0;
  while (state.phase !== "final_evaluation" && guard < 40) {
    const turn = await provider.generateInterviewTurn(buildInterviewContext(state, neutralAnswer));
    expect(isInterviewTurn(turn)).toBe(true);
    state = applyInterviewTurn(state, neutralAnswer, turn);
    visited.push(state.phase);
    guard += 1;
  }
  return { state, visited };
}

describe("scenario briefing", () => {
  it("opens with the scenario's own briefing instead of generic boilerplate", () => {
    const brief = scenarioBriefFor("youtube");
    const state = createInterviewState("Design YouTube", "hard", starterArchitectureFor("youtube"), {
      opening: brief.opening,
      description: brief.description,
    });
    expect(state.currentQuestion).toBe(brief.opening);
    expect(state.scenarioDescription).toBe(brief.description);
    expect(state.currentQuestion.toLowerCase()).toContain("youtube");
    expect(state.currentQuestion).not.toMatch(/i'?m your system-design interviewer/i);
  });

  it("starts every scenario from a single client node with no edges", () => {
    for (const scenario of ["youtube", "url-shortener", "whatsapp", "Design an Internal Platform"]) {
      const starter = starterArchitectureFor(scenario);
      expect(starter.nodes).toHaveLength(1);
      expect(starter.nodes[0].type).toBe("client");
      expect(starter.edges).toHaveLength(0);
    }
  });

  it("falls back to a usable opening when no brief is supplied", () => {
    const state = createInterviewState("Mystery System", "medium", architecture);
    expect(state.currentQuestion).toMatch(/interview/i);
    expect(state.scenarioDescription).toBe("Mystery System");
  });

  it("seeds the previous snapshot so the first turn reports no architecture changes", () => {
    const brief = scenarioBriefFor("youtube");
    const state = createInterviewState("Design YouTube", "hard", starterArchitectureFor("youtube"), brief);
    const context = buildInterviewContext(state, "Let's start.");
    expect(context.architectureChanges).toEqual({ added: [], removed: [], addedConnections: [], removedConnections: [] });
  });
});

describe("phase progression", () => {
  it("drives through every content phase and finishes instead of looping on one topic", async () => {
    const provider = getLLMProvider();
    const { state, visited } = await runFullInterview(provider, createInterviewState("Design YouTube", "hard", architecture));

    expect(state.phase).toBe("final_evaluation");
    const contentPhases = interviewPhases.filter((phase) => phase !== "final_evaluation");
    for (const phase of contentPhases) expect(visited).toContain(phase);

    // No single phase may consume more than the cap (plus the closing turn that
    // triggers the forced advance).
    const perPhase = new Map<string, number>();
    for (const phase of visited) perPhase.set(phase, (perPhase.get(phase) ?? 0) + 1);
    for (const [, count] of perPhase) expect(count).toBeLessThanOrEqual(MAX_TURNS_PER_PHASE + 1);
  });

  it("forces progress after the per-phase cap even when the model asks to stay", () => {
    // Distinct questions isolate the cap from the duplicate-question guard.
    const questions = [
      "Which product surfaces do users touch during onboarding?",
      "What is the busiest single workflow at launch?",
      "Which user action must stay consistent under heavy load?",
    ];
    let state = createInterviewState("Design YouTube", "hard", architecture);
    for (let index = 0; index < MAX_TURNS_PER_PHASE; index += 1) {
      state = applyInterviewTurn(state, neutralAnswer, turnFixture({ action: "follow_up", topic: "requirements", question: questions[index], message: questions[index] }));
      expect(state.phase).toBe("requirements");
    }
    expect(turnsInCurrentPhase(state)).toBe(MAX_TURNS_PER_PHASE);

    // One more answer in the same phase must be redirected to the next phase.
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ action: "follow_up", topic: "requirements", question: questions[MAX_TURNS_PER_PHASE], message: questions[MAX_TURNS_PER_PHASE] }));
    expect(state.phase).toBe("scale_estimation");
  });

  it("still honors an explicit revisit back to an earlier phase", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ action: "transition_phase", nextPhase: "scale_estimation", topic: "scale_estimation" }));
    expect(state.phase).toBe("scale_estimation");

    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ action: "transition_phase", nextPhase: "requirements", topic: "requirements" }));
    expect(state.phase).toBe("requirements");
  });
});

describe("question deduplication", () => {
  it("flags exact and lightly-reworded repeats but not genuinely new questions", () => {
    expect(isDuplicateQuestion("What are the two operations?", ["What are the two operations?"])).toBe(true);
    expect(isDuplicateQuestion(
      "What are the two most important operations this system must support?",
      ["What are the two important operations this system must support?"],
    )).toBe(true);
    expect(isDuplicateQuestion(
      "Which database engine best fits the read-heavy path?",
      ["How would you shard writes for hot users?"],
    )).toBe(false);
  });

  it("replaces a repeated question and moves to the next phase", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ question: "Why a relational database here?", message: "Why a relational database here?" }));
    expect(state.phase).toBe("requirements");
    expect(state.currentQuestion).toBe("Why a relational database here?");

    // The model asks the same thing again — it must not surface the repeat.
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ question: "Why a relational database here?", message: "Why a relational database here?" }));
    expect(state.currentQuestion).not.toBe("Why a relational database here?");
    expect(state.currentQuestion).toBe(phaseTransitionQuestion("scale_estimation"));
    expect(state.phase).toBe("scale_estimation");
  });

  it("keeps a genuinely different follow-up on the same topic", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    const first = "How would you shard the write path for hot users?";
    const second = "Which database would you pick for the media metadata, and why?";
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ question: first, message: first }));
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ question: second, message: second }));
    expect(state.currentQuestion).toBe(second);
    expect(state.phase).toBe("requirements");
  });

  it("never shows the same question twice even if the model loops forever", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    const stuck: Partial<InterviewTurn> = { action: "follow_up", topic: "requirements", question: "Can you explain your reasoning there?", message: "Can you explain your reasoning there?" };
    for (let index = 0; index < 5; index += 1) {
      state = applyInterviewTurn(state, neutralAnswer, turnFixture(stuck));
    }
    const asked = [...state.questionsAsked, state.currentQuestion];
    expect(new Set(asked).size).toBe(asked.length);
    expect(state.phase).not.toBe("requirements");
  });
});

describe("interview context", () => {
  it("reports turns in the current phase and the per-phase cap", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    expect(buildInterviewContext(state, neutralAnswer)).toMatchObject({
      turnsInPhase: 0,
      maxTurnsInPhase: MAX_TURNS_PER_PHASE,
    });
    state = applyInterviewTurn(state, neutralAnswer, turnFixture({ action: "follow_up", topic: "requirements" }));
    expect(buildInterviewContext(state, neutralAnswer).turnsInPhase).toBe(1);
  });

  it("computes added and removed components against the previous snapshot", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    const withCache: ArchitectureState = {
      nodes: [...architecture.nodes, { id: "cache", type: "cache", label: "Redis", x: 30, y: 5, reasoning: "read path", note: "" }],
      edges: architecture.edges.filter((edge) => edge.target !== "db"),
    };
    state = { ...state, architectureSnapshot: withCache };
    const context = buildInterviewContext(state, "I moved reads to Redis.");
    expect(context.architectureChanges.added).toEqual(["Redis"]);
    expect(context.architectureChanges.addedConnections).toEqual([]);
    // Dropping the api -> db edge is reported as a removed connection even
    // though PostgreSQL itself is still on the canvas.
    expect(context.architectureChanges.removedConnections).toEqual(["API Server -> PostgreSQL"]);
    // PostgreSQL is still a node, so it is not reported as removed; only the
    // edge was dropped. Removing the node itself is covered next.
    expect(context.architectureChanges.removed).toEqual([]);

    state = { ...state, architectureSnapshot: { nodes: withCache.nodes.filter((node) => node.id !== "db"), edges: withCache.edges } };
    expect(buildInterviewContext(state, "I dropped Postgres.").architectureChanges.removed).toEqual(["PostgreSQL"]);
  });

  it("flags an observation when the candidate edits the canvas without answering", () => {
    const state = createInterviewState("Design YouTube", "hard", architecture);
    expect(buildInterviewContext(state, "", true).observation).toBe(true);
    expect(buildInterviewContext(state, neutralAnswer).observation).toBe(false);
  });
});

describe("canvas observation turn", () => {
  it("records the interviewer's reaction without scoring a spoken answer", () => {
    const state = createInterviewState("Design YouTube", "hard", architecture);
    const turn = turnFixture({
      action: "component_challenge",
      message: "I see you added Redis — what does it offload?",
      question: "What does Redis offload from PostgreSQL?",
      topic: "caching",
    });
    const next = applyObservationTurn(state, turn);
    expect(next.answers).toHaveLength(0);
    expect(next.currentQuestion).toBe("What does Redis offload from PostgreSQL?");
    expect(next.currentQuestionData?.text).toBe("I see you added Redis — what does it offload?");
    expect(next.questionsAsked).toHaveLength(1);
    // The observed canvas becomes the new diff baseline so the same edit is
    // not reported twice.
    expect(next.previousArchitectureSnapshot).toEqual(state.architectureSnapshot);
  });

  it("honors an explicit phase request but never repeats a question", () => {
    let state = createInterviewState("Design YouTube", "hard", architecture);
    const first = turnFixture({
      action: "component_challenge",
      message: "You added Redis — why?",
      question: "Why did you add Redis?",
      topic: "caching",
      nextPhase: "scalability",
    });
    state = applyObservationTurn(state, first);
    // Drawing on the canvas can pull the conversation toward architecture, but
    // only when the model explicitly asks for the phase change.
    expect(state.phase).toBe("scalability");
    // The model may loop on the same challenge; the guard swaps it for a fresh
    // prompt rather than showing the identical question twice.
    state = applyObservationTurn(state, first);
    expect(state.currentQuestion).not.toBe("Why did you add Redis?");
    expect(state.currentQuestion).not.toBe("You added Redis — why?");
  });
});

describe("mock interviewer names the canvas edit it watched", () => {
  const provider = getLLMProvider();
  const extraNode = (id: string, label: string, type = "cache") => ({ id, label, type, x: 50, y: 50, reasoning: "reads dominate the path", note: "" });

  it("names a component the candidate just added, even though the canvas still has a validation error", async () => {
    const starter = starterArchitectureFor("youtube");
    const state: InterviewState = {
      ...createInterviewState("Design YouTube", "hard", starter),
      architectureSnapshot: { ...starter, nodes: [...starter.nodes, extraNode("redis", "Redis cache")] },
    };
    // The starter has an unconnected entry point, so validation reports an error.
    expect(buildInterviewContext(state, "", true).architectureValidation.findings.some((finding) => finding.severity === "error")).toBe(true);
    const turn = await provider.generateInterviewTurn(buildInterviewContext(state, "", true));
    expect(turn.message).toContain("Redis cache");
    expect(turn.question).toContain("Redis cache");
  });

  it("names a connection the candidate just drew", async () => {
    const starter = starterArchitectureFor("youtube");
    const twoUp: ArchitectureState = { ...starter, nodes: [...starter.nodes, extraNode("api", "API Server", "compute")] };
    const state: InterviewState = {
      ...createInterviewState("Design YouTube", "hard", starter),
      architectureSnapshot: { ...twoUp, edges: [{ id: "e1", source: starter.nodes[0].id, target: "api", label: "request" }] },
      previousArchitectureSnapshot: twoUp,
    };
    const turn = await provider.generateInterviewTurn(buildInterviewContext(state, "", true));
    expect(turn.message).toContain("Web Client -> API Server");
  });

  it("names a component the candidate just removed", async () => {
    const starter = starterArchitectureFor("youtube");
    const twoUp: ArchitectureState = { ...starter, nodes: [...starter.nodes, extraNode("redis", "Redis cache")] };
    const state: InterviewState = {
      ...createInterviewState("Design YouTube", "hard", starter),
      architectureSnapshot: starter,
      previousArchitectureSnapshot: twoUp,
    };
    const turn = await provider.generateInterviewTurn(buildInterviewContext(state, "", true));
    expect(turn.question).toContain("Redis cache");
  });
});

describe("multi-turn interview", () => {
  it("accumulates answers, questions, and a per-phase score across a full run", async () => {
    const provider = getLLMProvider();
    const { state } = await runFullInterview(provider, createInterviewState("Design YouTube", "hard", architecture));

    expect(state.answers.length).toBeGreaterThanOrEqual(interviewPhases.length - 2);
    expect(state.questionsAsked).toHaveLength(state.answers.length);
    // Every phase the candidate answered in should have a recorded score.
    const answeredPhases = new Set(state.answers.map((answer) => answer.phase));
    expect(Object.keys(state.score)).toHaveLength(answeredPhases.size);
    expect(answeredPhases.size).toBeGreaterThanOrEqual(interviewPhases.length - 3);
    for (const answer of state.answers) {
      expect(answer.score).toBeGreaterThanOrEqual(0);
      expect(answer.score).toBeLessThanOrEqual(1);
    }
  });

  it("settles a replication/sharding commitment instead of drilling into topology", async () => {
    const provider = getLLMProvider();
    const state = createInterviewState("Design YouTube", "hard", architecture);
    const context = buildInterviewContext(state, "We'll just enable replication and sharding, that's it, done.");
    const turn = await provider.generateInterviewTurn(context);
    expect(turn.message).toMatch(/config|settled/i);
    expect(turn.question.toLowerCase()).not.toMatch(/how many (replicas|shards)/);
  });

  it("notices a canvas edit and asks about it without scoring an answer", async () => {
    const provider = getLLMProvider();
    const base = createInterviewState("Design YouTube", "hard", architecture);
    // The candidate adds Redis to a valid design, then waits for the interviewer.
    const withCache: ArchitectureState = {
      nodes: [...base.architectureSnapshot.nodes, { id: "redis-0", type: "cache", label: "Redis", x: 30, y: 30, reasoning: "", note: "" }],
      edges: [...base.architectureSnapshot.edges, { id: "e3", source: "api", target: "redis-0", label: "cache" }],
    };
    const context = buildInterviewContext({ ...base, architectureSnapshot: withCache }, "", true);
    const turn = await provider.generateInterviewTurn(context);
    expect(turn.action).toBe("component_challenge");
    expect(turn.message).toMatch(/Redis/);
    const next = applyObservationTurn({ ...base, architectureSnapshot: withCache }, turn);
    expect(next.answers).toHaveLength(0);
    expect(next.currentQuestion.length).toBeGreaterThan(0);
  });
});

describe("evaluation across a full interview", () => {
  it("returns a bounded score with phase-coverage evidence in the summary", async () => {
    const provider = getLLMProvider();
    const { state } = await runFullInterview(provider, createInterviewState("Design YouTube", "hard", architecture));
    const report = buildEvaluationReport({
      scenario: state.scenario,
      validation: validateArchitecture(state.architectureSnapshot),
      turns: state.answers.length,
      answers: state.answers.map((answer) => ({ phase: answer.phase, score: answer.score ?? 0.6, answer: answer.answer })),
    });
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    expect(report.scorecard.overall.summary).toMatch(/coverage/i);
    expect(report.scorecard.answersAssessed).toBeGreaterThan(0);
    expect(report.strengths.length).toBeGreaterThan(0);
  });
});
