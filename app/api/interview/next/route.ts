import { NextResponse } from "next/server";
import { buildInterviewContext, isInterviewTurn, type InterviewState } from "../../../../lib/interview";
import { getLLMProvider } from "../../../../lib/llm-provider";
import { enforceRateLimit } from "../../../../lib/redis";
import { corsHeaders, jsonError, rejectCrossOrigin } from "../../../../lib/api";
import { notifyOperationalFailure, recordLatency, recordLLMFailure, recordRateLimit } from "../../../../lib/monitoring";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    return await handlePost(request);
  } finally {
    void recordLatency("interview/next", performance.now() - startedAt);
  }
}

async function handlePost(request: Request) {
  try {
    // Allow same-origin requests even if origin header is missing or mismatched
    // (e.g., when running on a different port locally)
    const origin = request.headers.get("origin");
    const isSameOrigin = !origin || origin.includes("localhost");
    if (!isSameOrigin && rejectCrossOrigin(request)) return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const rate = await enforceRateLimit(`interview:${ip}`, 20, 60);
    if (!rate.allowed) {
      recordRateLimit();
      notifyOperationalFailure("Rate limit exceeded", `IP ${ip} has exceeded the interview rate limit.`, "warning");
      return jsonError(request, "Interview limit reached. Please wait a minute before trying again.", 429, "RATE_LIMITED");
    }
    const payload = await request.json() as { state?: InterviewState; answer?: string; mode?: string };
    // "observe" is fired when the candidate edits the canvas without speaking:
    // the interviewer reacts to the change, so no spoken answer is required.
    const observing = payload.mode === "observe";
    if (!payload.state || typeof payload.answer !== "string" || (!observing && !payload.answer.trim())) {
      return jsonError(request, "A valid interview state and non-empty answer are required.", 400, "INVALID_REQUEST");
    }
    const context = buildInterviewContext(payload.state, payload.answer, observing);
    const turn = await getLLMProvider().generateInterviewTurn(context);
    if (!isInterviewTurn(turn)) return jsonError(request, "The interviewer returned an invalid response. Try again.", 502, "INVALID_PROVIDER_RESPONSE");
    return NextResponse.json({ turn, context: { phase: payload.state.phase, validationScore: context.architectureValidation.score } }, { headers: corsHeaders(request) });
  } catch (error) {
    console.error("[interview/next] provider failure:", error instanceof Error ? error.message : error);
    recordLLMFailure(error);
    notifyOperationalFailure("Blueprint interviewer failure", error instanceof Error ? error.message : "Unknown LLM failure", "critical");
    return jsonError(request, "The interviewer is temporarily unavailable. Check the monitoring page or try again shortly.", 502, "LLM_UNAVAILABLE");
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}
