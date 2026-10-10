import { NextResponse } from "next/server";
import { validateArchitecture } from "../../../../lib/architecture-validator";
import type { ArchitectureState } from "../../../../lib/architecture";
import { buildEvaluationReport, type ScorecardAnswer } from "../../../../lib/evaluation";
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
    if (!body.architecture || !Array.isArray(body.architecture.nodes) || !Array.isArray(body.architecture.edges)) {
      return NextResponse.json({ error: "A valid architecture is required.", code: "INVALID_INPUT" }, { status: 400 });
    }
    const validation = validateArchitecture(body.architecture);
    const report = buildEvaluationReport({
      scenario: body.scenario || "System design interview",
      validation,
      turns: body.turns || 0,
      answers: body.answers || [],
    });
    return NextResponse.json({ report });
  } catch {
    return NextResponse.json({ error: "Unable to generate evaluation.", code: "EVALUATION_FAILED" }, { status: 400 });
  }
}
