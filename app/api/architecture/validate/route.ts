import { NextResponse } from "next/server";
import { validateArchitecture } from "../../../../lib/architecture-validator";
import type { ArchitectureState } from "../../../../lib/architecture";
import { enforceRateLimit } from "../../../../lib/redis";
import { corsHeaders, jsonError, rejectCrossOrigin } from "../../../../lib/api";
import { recordLatency, recordRateLimit } from "../../../../lib/monitoring";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    return await handlePost(request);
  } finally {
    void recordLatency("architecture/validate", performance.now() - startedAt);
  }
}

async function handlePost(request: Request) {
  try {
    if (rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rate = await enforceRateLimit(`architecture:${ip}`, 60, 60);
    if (!rate.allowed) {
      recordRateLimit();
      return jsonError(request, "Architecture validation limit reached. Please wait a minute before trying again.", 429, "RATE_LIMITED");
    }
    const architecture = (await request.json()) as ArchitectureState;
    if (!architecture || !Array.isArray(architecture.nodes) || !Array.isArray(architecture.edges)) {
      return jsonError(request, "Architecture must include nodes and edges arrays.", 400, "INVALID_REQUEST");
    }
    return NextResponse.json(validateArchitecture(architecture), { headers: corsHeaders(request) });
  } catch {
    return jsonError(request, "Invalid JSON request.", 400, "INVALID_REQUEST");
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}
