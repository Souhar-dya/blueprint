import { describe, expect, it } from "vitest";
import { interviewPhases } from "../lib/interview";
import { validateArchitecture } from "../lib/architecture-validator";
import {
  assignedContentPhases,
  buildEvaluationReport,
  buildScorecard,
  competencyLevelScale,
  isSubstantiveAnswer,
  levelForSignal,
  structureSignal,
  unassignedPhases,
} from "../lib/evaluation";
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

describe("scorecard competency model", () => {
  it("assigns every content phase to exactly one competency", () => {
    const assigned = assignedContentPhases();
    expect(new Set(assigned).size).toBe(assigned.length);
    const contentPhases = interviewPhases.filter((phase) => phase !== "final_evaluation");
    for (const phase of contentPhases) expect(assigned).toContain(phase);
    expect(unassignedPhases).toEqual(["final_evaluation"]);
  });

  it("scores structured communication from answer structure, not interview scores", () => {
    const identicalText = "I would shard the database because the write path dominates. Then I would cache the read path at 5,000 per second.";
    const high = buildScorecard([{ phase: "requirements", score: 1, answer: identicalText }]);
    const low = buildScorecard([{ phase: "requirements", score: 0, answer: identicalText }]);
    const scoreOf = (card: ReturnType<typeof buildScorecard>, id: string) =>
      card.competencies.find((competency) => competency.id === id)?.score ?? null;
    expect(scoreOf(low, "structured_communication")).toBe(scoreOf(high, "structured_communication"));
    expect(scoreOf(high, "problem_framing")).toBe(100);
    expect(scoreOf(low, "problem_framing")).toBe(0);
  });
});

describe("level calibration", () => {
  it("maps 0..1 signals onto fixed anchor bands", () => {
    expect(levelForSignal(0).level).toBe(1);
    expect(levelForSignal(0.39).level).toBe(1);
    expect(levelForSignal(0.4).level).toBe(2);
    expect(levelForSignal(0.64).level).toBe(2);
    expect(levelForSignal(0.65).level).toBe(3);
    expect(levelForSignal(0.84).level).toBe(3);
    expect(levelForSignal(0.85).level).toBe(4);
    expect(levelForSignal(1).level).toBe(4);
    expect(levelForSignal(Number.NaN).level).toBe(1);
    expect(levelForSignal(2).level).toBe(4);
    expect(levelForSignal(-1).level).toBe(1);
  });

  it("keeps anchors increasing with the level", () => {
    expect(competencyLevelScale.map((entry) => entry.level)).toEqual([1, 2, 3, 4]);
    expect(competencyLevelScale.map((entry) => entry.min)).toEqual([0, 0.4, 0.65, 0.85]);
  });
});

describe("buildScorecard", () => {
  const answers = [
    { phase: "requirements", score: 0.9, answer: "Short links are the core operation because the read path dominates, around 10 million creates per day." },
    { phase: "scale_estimation", score: 0.9, answer: "Reads are roughly 100:1 against creates, so I would size for 1 billion redirects per day. Then I would keep the write path simple." },
    { phase: "data_model", score: 0.2, answer: "Store it in a database I guess." },
  ];

  it("calibrates each competency and cites real transcript excerpts", () => {
    const card = buildScorecard(answers);
    const framing = card.competencies.find((competency) => competency.id === "problem_framing");
    expect(framing?.level).toBe(4);
    expect(framing?.score).toBe(90);
    expect(framing?.answersAssessed).toBe(2);
    expect(framing?.evidence).toContain("2 answers scored across");
    expect(framing?.quotes[0]?.text).toContain("1 billion redirects per day");

    const data = card.competencies.find((competency) => competency.id === "data_and_interfaces");
    expect(data?.level).toBe(1);
    expect(data?.score).toBe(20);

    const communication = card.competencies.find((competency) => competency.id === "structured_communication");
    expect(communication?.level).not.toBeNull();
    expect(communication?.quotes.length).toBeGreaterThan(0);
  });

  it("marks competencies without evidence as not assessed instead of guessing", () => {
    const card = buildScorecard(answers);
    const operations = card.competencies.find((competency) => competency.id === "reliability_and_operations");
    expect(operations?.level).toBeNull();
    expect(operations?.score).toBeNull();
    expect(operations?.label).toBe("Not assessed");
    expect(operations?.evidence).toContain("No answers were captured");
    expect(operations?.quotes).toEqual([]);
  });

  it("stays fully uncalibrated when no answers were recorded", () => {
    const card = buildScorecard([]);
    expect(card.overall.score).toBeNull();
    expect(card.overall.label).toBe("Not assessed");
    expect(card.competencies.every((competency) => competency.level === null)).toBe(true);
    expect(card.overall.summary).toContain("No scored answers were captured");
    expect(card.answersAssessed).toBe(0);
  });

  it("summarizes the strongest area and the next practice target", () => {
    const card = buildScorecard(answers);
    expect(card.overall.score).not.toBeNull();
    expect(card.overall.summary).toContain("Strongest: Problem framing");
    expect(card.overall.summary).toContain("Focus next: Data and interfaces");
  });

  it("ranks structure signals for quotes and tolerates malformed input", () => {
    const card = buildScorecard([
      { phase: "api_design", answer: "vague" },
      { phase: "api_design", score: Number.NaN, answer: "" },
      { answer: "Because caching adds staleness. Then I would cap it with a TTL of 60 seconds at 5,000 rps." },
    ]);
    expect(card.competencies.every((competency) => competency.quotes.length <= 2)).toBe(true);
    expect(structureSignal("")).toBe(0);
    expect(structureSignal("Because it is faster. Then it fails less. And 5 of them.")).toBe(1);
  });

  it("treats trivial greetings as uncalibrating filler, not scored answers", () => {
    const card = buildScorecard([
      { phase: "requirements", score: 0.6, answer: "hi" },
      { phase: "requirements", score: 0.8, answer: "hello there" },
    ]);
    const framing = card.competencies.find((competency) => competency.id === "problem_framing");
    expect(framing?.level).toBeNull();
    expect(framing?.score).toBeNull();
    expect(framing?.label).toBe("Not assessed");
    expect(framing?.answersAssessed).toBe(0);
    expect(framing?.evidence).toContain("greetings or filler");
    expect(framing?.quotes).toEqual([]);
    expect(card.answersAssessed).toBe(0);
    expect(card.overall.score).toBeNull();
    const communication = card.competencies.find((competency) => competency.id === "structured_communication");
    expect(communication?.level).toBeNull();
  });

  it("excludes filler from the structure signal and counts only substantive answers", () => {
    const substantive = "The read path dominates because writes are rare, roughly 1,000 per second.";
    const card = buildScorecard([
      { phase: "requirements", score: 0.9, answer: substantive },
      { phase: "requirements", score: 0.9, answer: "ok thanks" },
    ]);
    const framing = card.competencies.find((competency) => competency.id === "problem_framing");
    expect(framing?.score).toBe(90);
    expect(framing?.answersAssessed).toBe(1);
    const communication = card.competencies.find((competency) => competency.id === "structured_communication");
    expect(communication?.answersAssessed).toBe(1);
    expect(card.answersAssessed).toBe(1);
  });

  it("keeps acknowledging 'I don\'t know' as a real answer", () => {
    expect(isSubstantiveAnswer("no idea")).toBe(true);
    expect(isSubstantiveAnswer("hi")).toBe(false);
    expect(isSubstantiveAnswer("")).toBe(false);
    expect(isSubstantiveAnswer("can you hear me")).toBe(false);
  });
});

describe("buildEvaluationReport", () => {
  const validation = validateArchitecture(architecture);
  const answers = [
    { phase: "requirements", score: 0.9, answer: "Short links dominate because the read path is 100:1 against creates. Then the write path stays simple." },
    { phase: "data_model", score: 0.3, answer: "A database." },
  ];

  it("blends architecture health with answer evidence for the headline score", () => {
    const report = buildEvaluationReport({ scenario: "Design YouTube", validation, turns: 3, answers });
    expect(report.scorecard.overall.score).not.toBeNull();
    expect(report.score).toBe(Math.round((validation.score + (report.scorecard.overall.score as number)) / 2));
    expect(report.scorecard.competencies).toHaveLength(5);
    expect(report.rubric.map((entry) => entry.competency)).toEqual(report.scorecard.competencies.map((entry) => entry.name));
    expect(report.rubric.every((entry) => entry.score >= 0 && entry.score <= 4)).toBe(true);
  });

  it("falls back to the participation formula when nothing was assessed", () => {
    const report = buildEvaluationReport({ scenario: "Design YouTube", validation, turns: 3, answers: [] });
    const conversationScore = Math.min(100, 50 + Math.min(30, 3 * 10) + (validation.valid ? 20 : 0));
    expect(report.score).toBe(Math.round((validation.score + conversationScore) / 2));
    expect(report.rubric.every((entry) => entry.score === 0)).toBe(true);
  });

  it("leads practice targets with the next level anchor for the weakest competency", () => {
    const report = buildEvaluationReport({ scenario: "Design YouTube", validation, turns: 1, answers });
    expect(report.improvements.length).toBeGreaterThan(0);
    expect(report.improvements[0]).toContain("Raise data and interfaces to");
    expect(report.improvements[0]).toContain(competencyLevelScale[1].anchor);
    expect(report.incident.expectedSignals).toHaveLength(3);
  });
});
