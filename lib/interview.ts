import type { ArchitectureState } from "./architecture";
import { validateArchitecture, type ArchitectureValidation } from "./architecture-validator";

export const interviewPhases = [
  "requirements",
  "scale_estimation",
  "high_level_architecture",
  "api_design",
  "data_model",
  "database_selection",
  "caching",
  "async_processing",
  "scalability",
  "reliability",
  "security",
  "observability",
  "production_incident",
  "final_evaluation",
] as const;

export type InterviewPhase = (typeof interviewPhases)[number];

/**
 * The most answers the interviewer may spend inside a single phase before it
 * is forced to move on. It keeps the interview broad — no getting stuck
 * interrogating one technology forever — while an explicit `nextPhase` may
 * still send the conversation back to an earlier phase on purpose.
 */
export const MAX_TURNS_PER_PHASE = 2;

/** How many answers have already been recorded in the state's current phase. */
export function turnsInCurrentPhase(state: InterviewState): number {
  return state.answers.filter((item) => item.phase === state.phase).length;
}
export type Difficulty = "easy" | "medium" | "hard" | "expert";
export type DifficultyAdjustment = "increase" | "decrease" | "hold";
export type ConversationMode = "introduction" | "requirements" | "discussion" | "component_challenge" | "follow_up" | "incident" | "evaluation";
export type InterviewAction = "acknowledge" | "follow_up" | "transition_phase" | "component_challenge" | "incident" | "evaluation";

export type InterviewQuestion = {
  id: string;
  type: ConversationMode;
  text: string;
  topic: string;
};

export type InterviewDecision = {
  topic: string;
  decision: string;
  rationale: string;
};

export type InterviewAnswer = {
  question: string;
  answer: string;
  phase: InterviewPhase;
  score?: number;
};

export type InterviewState = {
  scenario: string;
  difficulty: Difficulty;
  phase: InterviewPhase;
  conversationMode: ConversationMode;
  currentTopic: string;
  currentQuestionData?: InterviewQuestion;
  currentQuestion: string;
  questionsAsked: string[];
  answers: InterviewAnswer[];
  previousDecisions: InterviewDecision[];
  architectureSnapshot: ArchitectureState;
  /** The architecture as it stood when the last answer was given, so the
   * interviewer can react to components the candidate just added or changed. */
  previousArchitectureSnapshot?: ArchitectureState;
  /** Scenario briefing text the interviewer can lean on every turn. */
  scenarioDescription?: string;
  weakAreas: string[];
  strongAreas: string[];
  mistakes: string[];
  score: Record<string, number>;
  incident: string | null;
};

export type InterviewTurn = {
  action?: InterviewAction;
  message?: string;
  nextPhase?: InterviewPhase;
  question: string;
  reason: string;
  topic: string;
  difficultyAdjustment: DifficultyAdjustment;
  followUpType: "clarification" | "tradeoff" | "failure_mode" | "scale" | "incident";
  evaluation: { correctness: number; depth: number; tradeoffAwareness: number };
};

export type ArchitectureChanges = {
  /** Component labels the candidate added or removed since the previous turn. */
  added: string[];
  removed: string[];
  /** Connections ("A -> B") the candidate added or removed since the previous turn. */
  addedConnections: string[];
  removedConnections: string[];
};

export type InterviewContext = {
  state: InterviewState;
  answer: string;
  architectureValidation: ArchitectureValidation;
  /** Components and connections the candidate added or removed since the
   * previous turn — the interviewer should acknowledge and challenge those
   * changes specifically. */
  architectureChanges: ArchitectureChanges;
  /** True when the candidate just edited the canvas without giving a spoken
   * answer: the interviewer reacts to the edit itself, not to a sentence. */
  observation?: boolean;
  /** Answers already given in the current phase, and the cap after which the
   * interviewer must move the conversation to another topic. */
  turnsInPhase: number;
  maxTurnsInPhase: number;
};

export type ScenarioBriefInput = { opening?: string; description?: string };

/**
 * Falling back opening used only when no scenario brief is supplied (tests,
 * custom flows that don't resolve to a brief). Production interviews always
 * pass the scenario's own opening, never this generic text.
 */
const fallbackOpening = (scenario: string, difficulty: Difficulty) =>
  `This is your ${difficulty}-level ${scenario} interview. We'll move from requirements to scale to architecture, and I'll push on your choices until the design holds together. To start: who are the primary users, and what is the most important operation the system must support?`;

export function createInterviewState(scenario: string, difficulty: Difficulty, architecture: ArchitectureState, brief?: ScenarioBriefInput): InterviewState {
  const opening = brief?.opening?.trim() || fallbackOpening(scenario, difficulty);
  return {
    scenario,
    difficulty,
    phase: "requirements",
    conversationMode: "introduction",
    currentTopic: "requirements",
    currentQuestionData: { id: "opening-requirements", type: "introduction", topic: "requirements", text: opening },
    currentQuestion: opening,
    questionsAsked: [],
    answers: [],
    previousDecisions: [],
    architectureSnapshot: architecture,
    previousArchitectureSnapshot: { nodes: architecture.nodes.slice(), edges: architecture.edges.slice(), zones: architecture.zones?.slice() },
    scenarioDescription: brief?.description?.trim() || scenario,
    weakAreas: [],
    strongAreas: [],
    mistakes: [],
    score: {},
    incident: null,
  };
}

export function buildInterviewContext(state: InterviewState, answer: string, observation = false): InterviewContext {
  const current = {
    nodes: state.architectureSnapshot.nodes.slice(),
    edges: state.architectureSnapshot.edges.slice(),
    zones: state.architectureSnapshot.zones?.slice(),
  };
  const previousSnapshot = state.previousArchitectureSnapshot;
  const previous = previousSnapshot
    ? new Map(previousSnapshot.nodes.map((node) => [node.id, node.label]))
    : new Map<string, string>();
  const present = new Map(current.nodes.map((node) => [node.id, node.label]));
  // Connections are compared by their human-readable endpoints so a reconnected
  // pair reads the same however the underlying ids were generated.
  const connectionLabels = (snapshot: ArchitectureState) => {
    const labels = new Map(snapshot.nodes.map((node) => [node.id, node.label]));
    return snapshot.edges.map((edge) => `${labels.get(edge.source) || edge.source} -> ${labels.get(edge.target) || edge.target}`);
  };
  const previousConnections = new Set(previousSnapshot ? connectionLabels(previousSnapshot) : []);
  const currentConnections = connectionLabels(current);
  return {
    state: {
      ...state,
      architectureSnapshot: current,
    },
    answer: answer.trim(),
    architectureValidation: validateArchitecture(state.architectureSnapshot),
    architectureChanges: {
      added: current.nodes.filter((node) => !previous.has(node.id)).map((node) => node.label),
      removed: Array.from(previous.entries()).filter(([id]) => !present.has(id)).map(([, label]) => label),
      addedConnections: currentConnections.filter((label) => !previousConnections.has(label)),
      removedConnections: Array.from(previousConnections).filter((label) => !currentConnections.includes(label)),
    },
    observation,
    turnsInPhase: turnsInCurrentPhase(state),
    maxTurnsInPhase: MAX_TURNS_PER_PHASE,
  };
}

export function isInterviewTurn(value: unknown): value is InterviewTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  const evaluation = turn.evaluation as Record<string, unknown> | undefined;
  return typeof turn.question === "string"
    && typeof turn.reason === "string"
    && typeof turn.topic === "string"
    && ["increase", "decrease", "hold"].includes(turn.difficultyAdjustment as string)
    && ["clarification", "tradeoff", "failure_mode", "scale", "incident"].includes(turn.followUpType as string)
    && !!evaluation
    && ["correctness", "depth", "tradeoffAwareness"].every((key) => typeof evaluation[key] === "number");
}

/** Collapse question text to comparable words for duplicate detection. */
export function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// Words that carry little topical meaning; ignoring them keeps duplicate
// detection focused on the substance of a question rather than its phrasing.
const questionStopWords = new Set([
  "the", "and", "for", "are", "you", "your", "with", "that", "this", "what", "which", "how", "does",
  "will", "would", "can", "could", "should", "have", "has", "into", "from", "they", "them", "their",
  "there", "then", "than", "about", "when", "where", "why", "who", "just", "like", "some", "more",
  "most", "only", "also", "but", "not", "its", "our", "out", "use", "using", "get", "got", "one",
  "two", "any", "all", "it", "is", "be", "to", "of", "in", "on", "at", "or", "as", "an", "a", "we",
  "i", "do", "did", "so", "if", "me", "my", "us", "am", "was", "were", "been", "being", "then",
]);

function contentTokens(text: string): Set<string> {
  return new Set(normalizeQuestion(text).split(" ").filter((word) => word.length > 2 && !questionStopWords.has(word)));
}

/**
 * True when a question is the same — or nearly the same — as one the
 * interviewer already asked. Small models often reword a question by a word or
 * two when they are stuck; sharing most of their meaningful words (containment)
 * catches those near duplicates as well as exact repeats.
 */
export function isDuplicateQuestion(question: string, priorQuestions: readonly string[]): boolean {
  const normalized = normalizeQuestion(question);
  if (!normalized) return false;
  const candidate = contentTokens(question);
  for (const prior of priorQuestions) {
    const priorNormalized = normalizeQuestion(prior);
    if (!priorNormalized) continue;
    // An exact repeat is always a duplicate, however short the question is.
    if (normalized === priorNormalized) return true;
    const priorTokens = contentTokens(prior);
    if (candidate.size < 3 || priorTokens.size < 3) continue;
    let overlap = 0;
    for (const token of candidate) if (priorTokens.has(token)) overlap += 1;
    if (overlap / Math.min(candidate.size, priorTokens.size) >= 0.75) return true;
  }
  return false;
}

/** A fresh, phase-appropriate question used when the model loops on a topic. */
const phaseTransitionQuestions: Record<InterviewPhase, string> = {
  requirements: "Let's make the scope crisp: who are the core users, and what single operation matters most?",
  scale_estimation: "Put rough numbers on the workload — what read and write volume should this handle at peak?",
  high_level_architecture: "Walk me through one request end to end, from the client to wherever the durable state lives.",
  api_design: "What are the key APIs, and what does a request and response look like for the main operation?",
  data_model: "What are the core entities, and how do they relate to one another?",
  database_selection: "Which datastore holds the primary data, and what trade-off makes that the right choice?",
  caching: "Where would you cache, what is the cache key, and how do you avoid stale reads?",
  async_processing: "Which work leaves the synchronous path, and how is it queued and retried?",
  scalability: "How does this design hold up when traffic grows tenfold, and what breaks first?",
  reliability: "What happens when a critical component fails, and how does the system keep serving?",
  security: "How do you authenticate and authorize access to sensitive data?",
  observability: "What metrics, logs, and traces tell you the system is unhealthy before users complain?",
  production_incident: "Production degrades under a five-times traffic spike — what do you check first, and how do you mitigate it?",
  final_evaluation: "That covers the design — is there anything you would revisit or reinforce before we wrap up?",
};

export function phaseTransitionQuestion(phase: InterviewPhase): string {
  return phaseTransitionQuestions[phase] || "Let's shift to another part of the system — what would you examine next?";
}

export function applyInterviewTurn(state: InterviewState, answer: string, turn: InterviewTurn): InterviewState {
  const average = (turn.evaluation.correctness + turn.evaluation.depth + turn.evaluation.tradeoffAwareness) / 3;
  const weakAreas = average < 0.55 ? Array.from(new Set([...state.weakAreas, turn.topic])) : state.weakAreas;
  const strongAreas = average >= 0.8 ? Array.from(new Set([...state.strongAreas, turn.topic])) : state.strongAreas;
  const phaseIndex = interviewPhases.indexOf(state.phase);
  const isLastPhase = phaseIndex >= interviewPhases.length - 1;

  // Decide both the next phase and whether to replace the model's reply with a
  // fresh one. We refresh when the model repeated a question it already asked,
  // or when the per-phase cap forces a move to another phase. Refreshing keeps
  // the spoken prompt aligned with where the interview is heading instead of
  // re-asking the topic we just left.
  const priorReplies = [...state.questionsAsked, state.currentQuestion];
  const askedQuestion = (turn.question || turn.message || "").trim();
  const repeated = isDuplicateQuestion(askedQuestion, priorReplies);
  const requestedNext = turn.nextPhase && interviewPhases.includes(turn.nextPhase) ? turn.nextPhase : undefined;

  let nextPhase = requestedNext || (turn.action === "transition_phase" && !isLastPhase ? interviewPhases[phaseIndex + 1] : state.phase);
  let refresh = repeated;
  if (repeated) {
    nextPhase = requestedNext || (!isLastPhase ? interviewPhases[phaseIndex + 1] : state.phase);
  } else if (!isLastPhase && nextPhase === state.phase && turnsInCurrentPhase(state) >= MAX_TURNS_PER_PHASE) {
    nextPhase = interviewPhases[phaseIndex + 1];
    refresh = true;
  }

  const prompt = refresh ? phaseTransitionQuestion(nextPhase) : "";
  const resolved: InterviewTurn = refresh
    ? {
        ...turn,
        action: isLastPhase ? "follow_up" : "transition_phase",
        nextPhase: isLastPhase ? undefined : nextPhase,
        message: prompt,
        question: prompt,
        topic: nextPhase,
      }
    : turn;

  const action = resolved.action || (resolved.followUpType === "incident" ? "incident" : "follow_up");
  const mode: ConversationMode = action === "component_challenge" ? "component_challenge" : action === "incident" ? "incident" : action === "transition_phase" ? "discussion" : action === "evaluation" ? "evaluation" : action === "acknowledge" ? "discussion" : "follow_up";
  return {
    ...state,
    phase: nextPhase,
    conversationMode: mode,
    currentTopic: resolved.topic,
    currentQuestionData: { id: `q-${state.answers.length + 1}`, type: mode, topic: resolved.topic, text: resolved.message || resolved.question },
    currentQuestion: resolved.question,
    questionsAsked: [...state.questionsAsked, state.currentQuestion],
    answers: [...state.answers, { question: state.currentQuestion, answer, phase: state.phase, score: average }],
    previousDecisions: [...(state.previousDecisions || []), { topic: resolved.topic, decision: answer.slice(0, 180), rationale: resolved.reason }],
    previousArchitectureSnapshot: state.architectureSnapshot,
    weakAreas,
    strongAreas,
    score: { ...state.score, [state.phase]: Math.round(average * 10) },
  };
}

/**
 * Record the interviewer's reaction to a canvas edit. Unlike applyInterviewTurn
 * this does not record a candidate answer or score — the edit itself is the
 * prompt — but it does advance the conversation (current question, asked-question
 * history, and the diff baseline) so the interviewer keeps noticing the
 * candidate's next move. The phase is never force-advanced by the per-phase cap
 * here; it only moves when the model explicitly asks for it.
 */
export function applyObservationTurn(state: InterviewState, turn: InterviewTurn): InterviewState {
  const action = turn.action || "component_challenge";
  const mode: ConversationMode = action === "component_challenge" ? "component_challenge" : action === "incident" ? "incident" : action === "evaluation" ? "evaluation" : "follow_up";
  const requestedNext = turn.nextPhase && interviewPhases.includes(turn.nextPhase) ? turn.nextPhase : undefined;
  const nextPhase = requestedNext || state.phase;
  const requested = (turn.question || turn.message || "").trim();
  // Keep the interviewer from repeating a challenge it already voiced.
  const repeated = isDuplicateQuestion(requested, [...state.questionsAsked, state.currentQuestion]);
  const question = repeated ? phaseTransitionQuestion(nextPhase) : (turn.question || turn.message || requested);
  const message = repeated ? question : (turn.message || turn.question || question);
  return {
    ...state,
    phase: nextPhase,
    conversationMode: mode,
    currentTopic: turn.topic,
    currentQuestionData: { id: `q-obs-${state.questionsAsked.length + 1}`, type: mode, topic: turn.topic, text: message },
    currentQuestion: question,
    questionsAsked: [...state.questionsAsked, state.currentQuestion],
    previousDecisions: [...(state.previousDecisions || []), { topic: turn.topic, decision: "(canvas updated)", rationale: turn.reason }],
    previousArchitectureSnapshot: state.architectureSnapshot,
  };
}
