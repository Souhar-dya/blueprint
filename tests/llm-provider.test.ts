import { afterEach, describe, expect, it } from "vitest";
import { getLLMProvider, getCritiqueProvider, type LLMProvider } from "../lib/llm-provider";
import { createInterviewState, buildInterviewContext } from "../lib/interview";
import type { ArchitectureState } from "../lib/architecture";

const envKeys = ["LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_CRITIQUE_MODEL"] as const;
let originalEnv: Record<string, string | undefined>;

afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function captureEnv() {
  originalEnv = {};
  for (const key of envKeys) originalEnv[key] = process.env[key];
}

const architecture: ArchitectureState = {
  nodes: [
    { id: "client", type: "client", label: "Web Client", x: 0, y: 0, reasoning: "entry", note: "" },
    { id: "api", type: "compute", label: "API Server", x: 10, y: 10, reasoning: "handles requests", note: "" },
    { id: "db", type: "database", label: "PostgreSQL", x: 20, y: 20, reasoning: "durable state", note: "" },
  ],
  edges: [
    { id: "e1", source: "client", target: "api", label: "HTTPS" },
    { id: "e2", source: "api", target: "db", label: "SQL" },
  ],
};

describe("getLLMProvider", () => {
  captureEnv();

  it("returns a mock provider by default", () => {
    delete process.env.LLM_PROVIDER;
    const provider = getLLMProvider();
    expect(provider).toBeDefined();
    expect(provider.generateInterviewTurn).toBeInstanceOf(Function);
  });

  it("returns a provider for ollama configuration", () => {
    process.env.LLM_PROVIDER = "ollama";
    process.env.LLM_MODEL = "llama3.1:8b";
    const provider = getLLMProvider();
    expect(provider).toBeDefined();
  });

  it("returns a provider for qwen configuration", () => {
    process.env.LLM_PROVIDER = "qwen";
    process.env.LLM_MODEL = "qwen-plus";
    process.env.LLM_API_KEY = "test-key";
    const provider = getLLMProvider();
    expect(provider).toBeDefined();
  });

  it("throws when model is missing for non-mock providers", () => {
    process.env.LLM_PROVIDER = "openai-compatible";
    delete process.env.LLM_MODEL;
    expect(() => getLLMProvider()).toThrow("LLM_MODEL is required");
  });
});

describe("MockLLMProvider", () => {
  it("returns a valid interview turn for a greeting", async () => {
    const provider = getLLMProvider() as LLMProvider;
    const state = createInterviewState("Design YouTube", "hard", architecture);
    const context = buildInterviewContext(state, "hello");
    const turn = await provider.generateInterviewTurn(context);
    expect(turn.question).toBeTruthy();
    expect(turn.reason).toBeTruthy();
    expect(turn.topic).toBeTruthy();
    expect(["increase", "decrease", "hold"]).toContain(turn.difficultyAdjustment);
    expect(turn.evaluation).toBeDefined();
    expect(turn.evaluation.correctness).toBeGreaterThanOrEqual(0);
    expect(turn.evaluation.correctness).toBeLessThanOrEqual(1);
  });

  it("handles unknown answers gracefully", async () => {
    const provider = getLLMProvider() as LLMProvider;
    const state = createInterviewState("Design YouTube", "hard", architecture);
    const context = buildInterviewContext(state, "I don't know");
    const turn = await provider.generateInterviewTurn(context);
    expect(turn.question).toBeTruthy();
    expect(turn.topic).toBe("requirements");
  });

  it("covers all 14 interview phases with specific prompts", async () => {
    const provider = getLLMProvider() as LLMProvider;
    const phases = [
      "requirements", "scale_estimation", "high_level_architecture", "api_design",
      "data_model", "database_selection", "caching", "async_processing",
      "scalability", "reliability", "security", "observability", "production_incident",
    ];
    for (const phase of phases) {
      const state = createInterviewState("Design YouTube", "hard", architecture);
      (state as Record<string, unknown>).phase = phase;
      const context = buildInterviewContext(state, "I would use a load balancer because it distributes traffic.");
      const turn = await provider.generateInterviewTurn(context);
      expect(turn.question).toBeTruthy();
      expect(turn.question.length).toBeGreaterThan(20);
    }
  });

  it("detects architecture errors and redirects", async () => {
    const provider = getLLMProvider() as LLMProvider;
    const brokenArch: ArchitectureState = {
      nodes: [{ id: "api", type: "compute", label: "API Server", x: 10, y: 10, reasoning: "", note: "" }],
      edges: [{ id: "e1", source: "api", target: "missing", label: "HTTP" }],
    };
    const state = createInterviewState("Design YouTube", "hard", brokenArch);
    const context = buildInterviewContext(state, "I would use a load balancer.");
    const turn = await provider.generateInterviewTurn(context);
    expect(turn.topic).toBe("high_level_architecture");
    expect(turn.message).toContain("broken critical path");
  });
});

describe("getCritiqueProvider", () => {
  captureEnv();

  it("falls back to the interviewer model when no critique model is configured", () => {
    process.env.LLM_PROVIDER = "ollama";
    process.env.LLM_MODEL = "gpt-oss:120b";
    delete process.env.LLM_CRITIQUE_MODEL;
    expect(() => getCritiqueProvider()).not.toThrow();
  });

  it("writes a model-authored critique in mock mode", async () => {
    delete process.env.LLM_PROVIDER;
    const provider = getCritiqueProvider();
    const critique = await provider.generateCritique({
      scenario: "Design YouTube",
      score: 42,
      architecture: { nodes: ["Web Client", "API Server"], connections: ["Web Client -> API Server"] },
      validation: { score: 90, findings: ["warning: single-database — only one store"] },
      competencies: [
        { name: "Problem framing", level: 3, score: 90 },
        { name: "Data and interfaces", level: 1, score: 20 },
      ],
      answers: [{ phase: "requirements", answer: "Short links dominate because reads outnumber writes." }],
      strengths: ["Clear component boundaries"],
      improvements: ["Justify the storage choice"],
    });
    expect(critique).not.toBeNull();
    expect(critique?.summary).toContain("42/100");
    expect(critique?.summary).toContain("Data and interfaces");
    expect(critique?.strengths).toContain("Clear component boundaries");
    expect(critique?.improvements).toContain("Justify the storage choice");
  });
});
