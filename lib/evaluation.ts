import type { InterviewPhase } from "./interview";
import type { ArchitectureValidation } from "./architecture-validator";
import { interviewPhases } from "./interview";

export type CompetencyLevel = 1 | 2 | 3 | 4;

export type LevelDefinition = {
  level: CompetencyLevel;
  label: string;
  min: number;
  anchor: string;
};

/**
 * Level calibration shared by every competency. Signals are means on a 0..1
 * scale: per-answer interview scores for content competencies, and a
 * structure signal for communication. Anchors describe what reaching the
 * level actually looks like, so a score is always interpretable.
 */
export const competencyLevelScale: readonly LevelDefinition[] = [
  { level: 1, label: "Emerging", min: 0, anchor: "Addresses the topic only partially; the decision arrives without rationale or required detail." },
  { level: 2, label: "Developing", min: 0.4, anchor: "Reaches a workable decision with rationale, but trade-offs stay implicit." },
  { level: 3, label: "Proficient", min: 0.65, anchor: "Justifies the decision against constraints and names at least one explicit trade-off." },
  { level: 4, label: "Strong", min: 0.85, anchor: "Compares alternatives, ties decisions to requirements and scale, and anticipates failure modes." },
];

export function levelForSignal(signal: number): LevelDefinition {
  const safe = Number.isFinite(signal) ? Math.min(1, Math.max(0, signal)) : 0;
  let matched: LevelDefinition = competencyLevelScale[0];
  for (const definition of competencyLevelScale) if (safe >= definition.min) matched = definition;
  return matched;
}

export type CompetencyDefinition = {
  id: string;
  name: string;
  focus: string;
  phases: readonly InterviewPhase[];
};

/**
 * The scorecard uses explicit, non-overlapping competencies. Every content
 * phase belongs to exactly one competency (see tests/evaluation.test.ts),
 * except `final_evaluation`, which is the closing feedback exchange and
 * carries no design decision to assess. Structured communication is scored
 * from answer structure only, never from the content scores already counted
 * elsewhere, so no evidence is double-counted across rows.
 */
export const scorecardCompetencies: readonly CompetencyDefinition[] = [
  {
    id: "problem_framing",
    name: "Problem framing",
    focus: "Functional and non-functional requirements, and workload estimation.",
    phases: ["requirements", "scale_estimation"],
  },
  {
    id: "system_architecture",
    name: "System architecture",
    focus: "Component decomposition, the critical request path, and asynchronous boundaries.",
    phases: ["high_level_architecture", "async_processing"],
  },
  {
    id: "data_and_interfaces",
    name: "Data and interfaces",
    focus: "API contracts, data modeling, storage selection, and caching.",
    phases: ["api_design", "data_model", "database_selection", "caching"],
  },
  {
    id: "reliability_and_operations",
    name: "Reliability and operations",
    focus: "Scaling, failure handling, security, observability, and incident response.",
    phases: ["scalability", "reliability", "security", "observability", "production_incident"],
  },
  {
    id: "structured_communication",
    name: "Structured communication",
    focus: "Structure and specificity of the explanations themselves, measured independently of topic content.",
    phases: [],
  },
];

export type ScorecardAnswer = {
  phase?: string;
  score?: number;
  answer?: string;
};

export type ScorecardQuote = {
  phase: string;
  text: string;
};

export type ScorecardCompetency = {
  id: string;
  name: string;
  focus: string;
  level: CompetencyLevel | null;
  label: string;
  score: number | null;
  anchor: string;
  evidence: string;
  quotes: ScorecardQuote[];
  answersAssessed: number;
};

export type EvaluationScorecard = {
  competencies: ScorecardCompetency[];
  scale: LevelDefinition[];
  answersAssessed: number;
  overall: {
    score: number | null;
    level: CompetencyLevel | null;
    label: string;
    summary: string;
  };
};

export type EvaluationReport = {
  scenario: string;
  score: number;
  scorecard: EvaluationScorecard;
  strengths: string[];
  improvements: string[];
  /** Legacy view kept for older clients: score is the 1..4 level, 0 when not assessed. */
  rubric: Array<{ competency: string; score: number; evidence: string }>;
  incident: {
    prompt: string;
    expectedSignals: string[];
  };
};

type NormalizedAnswer = {
  phase: string;
  score: number | null;
  text: string;
};

const structureConnective = /\b(because|since|instead of|rather than|trade-?off|otherwise|however|so that|which means|in case|first|then|finally)\b/i;
const structureNumber = /\b\d[\d,.]*\b/;
const structureMarkerCount = 3;

/**
 * Greetings and pure social filler ("hi", "ok thanks", "can you hear me")
 * carry no design substance. They must not calibrate any competency, so a
 * trivial greeting can no longer inflate a content row or count as structure
 * evidence. Only strings made entirely of these tokens (optionally repeated,
 * with punctuation) are treated as filler — answers that add any other word
 * are substantive and always count.
 */
const trivialFillerAnswer =
  /^(?:(?:hi+|hello+|heya|hiya|hey+|yo+|howdy|how\s+are\s+you|hola|sup|aloha|good\s+(?:morning|afternoon|evening)|(?:ok|okay)\s+then|yes|yeah|yep|yup|no|nope|nah|ok|okay|kk?|sure|fine|alright|right|great|cool|nice|thanks|thank\s+you|ty|thx|mic\s+(?:test|check)|can\s+you\s+(?:hear|see)\s+me|are\s+you\s+there|testing|test|there|um+|uh+|hmm+|mmm+)(?:[\s.,!?]+|$))+$/i;

export function isSubstantiveAnswer(text: string | undefined | null): boolean {
  const cleaned = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return Boolean(cleaned) && !trivialFillerAnswer.test(cleaned);
}

function normalizeAnswer(answer: ScorecardAnswer): NormalizedAnswer {
  const rawScore = typeof answer?.score === "number" && Number.isFinite(answer.score) ? answer.score : null;
  return {
    phase: typeof answer?.phase === "string" ? answer.phase : "",
    score: rawScore === null ? null : Math.min(1, Math.max(0, rawScore)),
    text: typeof answer?.answer === "string" ? answer.answer.replace(/\s+/g, " ").trim() : "",
  };
}

function phaseLabel(phase: string): string {
  return phase ? phase.replaceAll("_", " ") : "general";
}

function excerpt(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  const trimmed = boundary > max * 0.6 ? cut.slice(0, boundary) : cut;
  return `${trimmed.replace(/[.,;:]$/, "")}…`;
}

/** 0..1 signal for how structured and specific an answer is, independent of its interview score. */
export function structureSignal(text: string): number {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return 0;
  // Very short or trivial answers (greetings, acknowledgments) score 0 regardless
  // of punctuation; this stops averaging "hi" into a 100-point score.
  if (trimmed.length < 12 || /^(hi|hello|hey|thanks|thank you|yes|no|okay|ok|sure|yep|yeah|got it|cool|nice|i see|right|i understand|can you hear|good|great|good point|interesting|not sure|i don't know|sorry|dunno)\b/i.test(trimmed)) {
    return 0;
  }
  let matched = 0;
  if (structureConnective.test(trimmed)) matched += 1;
  if (structureNumber.test(trimmed)) matched += 1;
  if ((trimmed.match(/[.!?]+/g) || []).length >= 2) matched += 1;
  return matched / structureMarkerCount;
}

function pickQuotes(answers: readonly NormalizedAnswer[], rank: (answer: NormalizedAnswer) => number): ScorecardQuote[] {
  const seen = new Set<string>();
  const ranked = answers
    .filter((answer) => answer.text)
    .slice()
    .sort((a, b) => rank(b) - rank(a) || b.text.length - a.text.length);
  const quotes: ScorecardQuote[] = [];
  for (const answer of ranked) {
    const key = answer.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push({ phase: phaseLabel(answer.phase), text: excerpt(answer.text) });
    if (quotes.length === 2) break;
  }
  return quotes;
}

function notAssessedEvidence(hasUnscoredAnswers: boolean, greetingOnly = false): string {
  if (greetingOnly) return "Only greetings or filler answers were captured in this area, so it stays uncalibrated.";
  return hasUnscoredAnswers
    ? "Answers were recorded here but never scored, so this area stays uncalibrated."
    : "No answers were captured in this area, so it stays uncalibrated.";
}

function buildContentCompetency(definition: CompetencyDefinition, answers: readonly NormalizedAnswer[]): ScorecardCompetency {
  const inScope = answers.filter((answer) => answer.text && isSubstantiveAnswer(answer.text) && definition.phases.includes(answer.phase as InterviewPhase));
  const greetingOnly = inScope.length === 0 && answers.some((answer) => answer.text && !isSubstantiveAnswer(answer.text) && definition.phases.includes(answer.phase as InterviewPhase));
  const scored = inScope.filter((answer) => answer.score !== null);
  const quotes = pickQuotes(inScope, (answer) => answer.score ?? 0);
  if (!scored.length) {
    return {
      id: definition.id,
      name: definition.name,
      focus: definition.focus,
      level: null,
      label: "Not assessed",
      score: null,
      anchor: "Not assessed",
      evidence: notAssessedEvidence(inScope.length > 0, greetingOnly),
      quotes,
      answersAssessed: 0,
    };
  }
  const signal = scored.reduce((total, answer) => total + (answer.score as number), 0) / scored.length;
  const calibration = levelForSignal(signal);
  const phases = Array.from(new Set(inScope.map((answer) => phaseLabel(answer.phase)))).join(", ");
  return {
    id: definition.id,
    name: definition.name,
    focus: definition.focus,
    level: calibration.level,
    label: calibration.label,
    score: Math.round(signal * 100),
    anchor: calibration.anchor,
    evidence: `${scored.length} answer${scored.length === 1 ? "" : "s"} scored across ${phases}. ${calibration.anchor}`,
    quotes,
    answersAssessed: scored.length,
  };
}

function buildCommunicationCompetency(definition: CompetencyDefinition, answers: readonly NormalizedAnswer[]): ScorecardCompetency {
  const withText = answers.filter((answer) => answer.text && isSubstantiveAnswer(answer.text));
  const greetingOnly = withText.length === 0 && answers.some((answer) => answer.text && !isSubstantiveAnswer(answer.text));
  const quotes = pickQuotes(withText, (answer) => structureSignal(answer.text));
  if (!withText.length) {
    return {
      id: definition.id,
      name: definition.name,
      focus: definition.focus,
      level: null,
      label: "Not assessed",
      score: null,
      anchor: "Not assessed",
      evidence: notAssessedEvidence(false, greetingOnly),
      quotes,
      answersAssessed: 0,
    };
  }
  const signal = withText.reduce((total, answer) => total + structureSignal(answer.text), 0) / Math.max(1, withText.length);
  const calibration = levelForSignal(signal);
  return {
    id: definition.id,
    name: definition.name,
    focus: definition.focus,
    level: calibration.level,
    label: calibration.label,
    score: Math.round(signal * 100),
    anchor: calibration.anchor,
    evidence: `${withText.length} answer${withText.length === 1 ? "" : "s"} scored on structure: sequencing and trade-off language, concrete numbers, and complete sentences. ${calibration.anchor}`,
    quotes,
    answersAssessed: withText.length,
  };
}

function buildOverallSummary(competencies: readonly ScorecardCompetency[], coverage: number | null): EvaluationScorecard["overall"] {
  const assessed = competencies.filter((competency) => competency.score !== null) as Array<ScorecardCompetency & { score: number }>;
  if (!assessed.length) {
    return {
      score: null,
      level: null,
      label: "Not assessed",
      summary: "No scored answers were captured, so the competency scorecard stays uncalibrated. Architecture health still reflects deterministic checks.",
    };
  }
  const score = Math.round(assessed.reduce((total, competency) => total + competency.score, 0) / Math.max(1, assessed.length));
  const calibration = levelForSignal(score / 100);
  const parts = [`Overall ${calibration.label} (${score}/100).`];
  const sorted = assessed.slice().sort((a, b) => b.score - a.score);
  const strongest = sorted[0];
  const focus = sorted[sorted.length - 1];
  if (assessed.length >= 2 && strongest.id !== focus.id) {
    parts.push(`Strongest: ${strongest.name} (${strongest.label}). Focus next: ${focus.name} (${focus.label}).`);
  } else if (assessed.length === 1) {
    parts.push(`${strongest.name} is the only area with scored evidence; answer in more phases to calibrate the rest.`);
  } else {
    parts.push(`An even profile across ${assessed.length} assessed competencies.`);
  }
  if (coverage !== null) parts.push(`Coverage: ${Math.round(coverage * 100)}% of design phases addressed.`);
  return { score, level: calibration.level, label: calibration.label, summary: parts.join(" ") };
}

export function buildScorecard(answers: readonly ScorecardAnswer[] = []): EvaluationScorecard {
  const normalized = (answers || []).map(normalizeAnswer);
  const competencies = scorecardCompetencies.map((definition) =>
    definition.phases.length
      ? buildContentCompetency(definition, normalized)
      : buildCommunicationCompetency(definition, normalized),
  );
  const contentPhases = interviewPhases.filter((phase) => phase !== "final_evaluation");
  const coveredPhases = new Set<string>(normalized.filter((answer) => answer.text && isSubstantiveAnswer(answer.text)).map((answer) => answer.phase));
  const coverage = contentPhases.length ? contentPhases.filter((phase) => coveredPhases.has(phase)).length / contentPhases.length : null;
  return {
    competencies,
    scale: competencyLevelScale.map((definition) => ({ ...definition })),
    answersAssessed: normalized.filter((answer) => answer.text && isSubstantiveAnswer(answer.text)).length,
    overall: buildOverallSummary(competencies, coverage),
  };
}

export function buildEvaluationReport(input: {
  scenario: string;
  validation: ArchitectureValidation;
  turns: number;
  answers?: readonly ScorecardAnswer[];
}): EvaluationReport {
  const { validation } = input;
  const scorecard = buildScorecard(input.answers || []);
  // Participation turns count substantive answers only; greetings and filler
  // must not inflate the fallback headline score.
  const answers = input.answers || [];
  const participationTurns = answers.length > 0 ? answers.filter((answer) => isSubstantiveAnswer(answer?.answer)).length : (input.turns || 0);
  const conversationScore = Math.min(100, 50 + Math.min(30, participationTurns * 10) + (validation.valid ? 20 : 0));
  const score = scorecard.overall.score !== null
    ? Math.round((validation.score + scorecard.overall.score) / 2)
    : Math.round((validation.score + conversationScore) / 2);

  const strengths = validation.valid
    ? ["Clear component boundaries", "Architecture passes deterministic checks"]
    : ["You identified core system components"];
  for (const competency of scorecard.competencies) {
    if (strengths.length >= 4) break;
    if (competency.level === 4 || competency.level === 3) strengths.push(`Strongest signal: ${competency.name} (${competency.label}).`);
  }
  const contentPhases = interviewPhases.filter((phase) => phase !== "final_evaluation");
  const coveredPhases = new Set<string>(answers.filter((answer) => isSubstantiveAnswer(answer?.answer)).map((answer) => String(answer?.phase || "")));
  const coverageRatio = contentPhases.length ? contentPhases.filter((phase) => coveredPhases.has(phase)).length / contentPhases.length : 0;
  if (strengths.length < 4 && coverageRatio >= 0.5) {
    strengths.push(`Broad coverage: you answered into ${coveredPhases.size} of ${contentPhases.length} design phases.`);
  }

  const weakest = scorecard.competencies
    .filter((competency) => competency.score !== null)
    .sort((a, b) => (a.score as number) - (b.score as number))[0];
  const practice: string[] = [];
  if (weakest && weakest.level !== null && weakest.level < 4) {
    const next = competencyLevelScale[weakest.level];
    practice.push(`Raise ${weakest.name.toLowerCase()} to ${next.label}: ${next.anchor}`);
  }
  const missingPhases = contentPhases.filter((phase) => !coveredPhases.has(phase)).slice(0, 3).map((phase) => phase.replaceAll("_", " "));
  const improvements = [
    ...practice,
    ...validation.findings.slice(0, 3).map((finding) => finding.detail),
    ...(coverageRatio < 0.5 && missingPhases.length ? [`Broaden coverage: ${missingPhases.join(", ")} ${missingPhases.length === 1 ? "was" : "were"} not addressed in depth.`] : []),
  ].slice(0, 4);

  return {
    scenario: input.scenario || "System design interview",
    score,
    scorecard,
    strengths,
    improvements,
    rubric: scorecard.competencies.map((competency) => ({
      competency: competency.name,
      score: competency.level ?? 0,
      evidence: competency.evidence,
    })),
    incident: {
      prompt: "Traffic is now 5× higher than forecast and the primary database is at 90% capacity. What fails first?",
      expectedSignals: [
        "Protect the database with caching or read replicas",
        "Define a graceful degradation path",
        "Explain monitoring and rollback triggers",
      ],
    },
  };
}

/** Guard used by tests: every phase except the closing exchange maps to exactly one content competency. */
export function assignedContentPhases(): InterviewPhase[] {
  return scorecardCompetencies.flatMap((competency) => [...competency.phases]);
}

const assignedPhaseSet = new Set<string>(assignedContentPhases());
export const unassignedPhases: readonly InterviewPhase[] = interviewPhases.filter((phase) => !assignedPhaseSet.has(phase));
