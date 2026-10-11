import { NextResponse } from "next/server";
import { validateArchitecture } from "../../../../lib/architecture-validator";
import type { ArchitectureState } from "../../../../lib/architecture";
import { buildEvaluationReport, type ScorecardAnswer } from "../../../../lib/evaluation";
import { getCritiqueProvider } from "../../../../lib/llm-provider";
import { recordLatency } from "../../../../lib/monitoring";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    return await handlePost(request);
  } finally {
    void recordLatency("interviews/evaluation", performance.now() - startedAt);
  }
}

async function handlePost(request: Request) {
  try {
    const body = await request.json() as { architecture?: ArchitectureState; turns?: number; scenario?: string; answers?: ScorecardAnswer[] };
    const architecture = body.architecture;
    if (!architecture || !Array.isArray(architecture.nodes) || !Array.isArray(architecture.edges)) {
      return NextResponse.json({ error: "A valid architecture is required.", code: "INVALID_INPUT" }, { status: 400 });
    }
    const validation = validateArchitecture(architecture);
    const report = buildEvaluationReport({
      scenario: body.scenario || "System design interview",
      validation,
      turns: body.turns || 0,
      answers: body.answers || [],
    });
    // The scoring is deterministic; the critique is a model-authored reading of
    // it, written on the (smaller, faster) critique model. If that model is slow
    // or unreachable, the report is still returned without a critique.
    const nodeLabel = (id: string) => architecture.nodes.find((node) => node.id === id)?.label || id;
    try {
      const critique = await getCritiqueProvider().generateCritique({
        scenario: report.scenario,
        score: report.score,
        architecture: {
          nodes: architecture.nodes.map((node) => node.label),
          connections: architecture.edges.map((edge) => `${nodeLabel(edge.source)} -> ${nodeLabel(edge.target)}${edge.label ? ` (${edge.label})` : ""}`),
        },
        validation: {
          score: validation.score,
          findings: validation.findings.map((finding) => `${finding.severity}: ${finding.title} — ${finding.detail}`),
        },
        competencies: report.scorecard.competencies.map((competency) => ({ name: competency.name, level: competency.level, score: competency.score })),
        answers: (body.answers || []).filter((answer) => answer.answer).map((answer) => ({ phase: answer.phase, answer: answer.answer })),
        strengths: report.strengths,
        improvements: report.improvements,
      });
      if (critique) report.critique = critique;
    } catch {
      // Best-effort criticism only; the deterministic scorecard always stands.
    }
    return NextResponse.json({ report });
  } catch {
    return NextResponse.json({ error: "Unable to generate evaluation.", code: "EVALUATION_FAILED" }, { status: 400 });
  }
}
