import { NextResponse } from "next/server";
import { corsHeaders, jsonError, rejectCrossOrigin } from "../../../lib/api";
import { synthesizeSpeech, sanitizeSpeechText, resolveVoice } from "../../../lib/tts";
import { recordLatency } from "../../../lib/monitoring";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    return await handlePost(request);
  } finally {
    void recordLatency("tts", performance.now() - startedAt);
  }
}

async function handlePost(request: Request) {
  try {
    const origin = request.headers.get("origin");
    const isSameOrigin = !origin || origin.includes("localhost");
    if (!isSameOrigin && rejectCrossOrigin(request)) {
      return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    }
    const body = await request.json().catch(() => null) as { text?: unknown; voice?: unknown } | null;
    if (!body || typeof body.text !== "string" || !body.text.trim()) {
      return jsonError(request, "A non-empty text field is required.", 400, "INVALID_REQUEST");
    }
    const text = sanitizeSpeechText(body.text);
    if (text.length === 0) {
      return jsonError(request, "The text to speak is empty after sanitization.", 400, "EMPTY_TEXT");
    }
    const voice = resolveVoice(body.voice);
    const buffer = await synthesizeSpeech(text, voice);
    const base64 = buffer.toString("base64");
    const duration = Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length * 200 / 1000));
    return NextResponse.json(
      { audio: `data:audio/mpeg;base64,${base64}`, duration },
      { headers: corsHeaders(request) }
    );
  } catch (error) {
    return jsonError(request, error instanceof Error ? error.message : "TTS synthesis failed.", 502, "TTS_FAILED");
  }
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}
