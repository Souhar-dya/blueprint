import { NextResponse } from "next/server";
import { corsHeaders, jsonError, rejectCrossOrigin } from "../../../lib/api";
import { recordLatency } from "../../../lib/monitoring";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    return await handlePost(request);
  } finally {
    void recordLatency("transcribe", performance.now() - startedAt);
  }
}

async function handlePost(request: Request) {
  try {
    // Allow same-origin requests even if origin header is missing or mismatched
    // (e.g., when running on a different port locally)
    const origin = request.headers.get("origin");
    const isSameOrigin = !origin || origin.includes("localhost");
    if (!isSameOrigin && rejectCrossOrigin(request)) {
      return jsonError(request, "This API only accepts requests from the configured application origin.", 403, "ORIGIN_NOT_ALLOWED");
    }
    const formData = await request.formData();
    const audio = formData.get("audio") as Blob | null;
    if (!audio || audio.size === 0) {
      return NextResponse.json({ error: "No audio received.", code: "NO_AUDIO" }, { status: 400, headers: corsHeaders(request) });
    }

    // Transcription can point at a different backend than the chat provider.
    // Chat may run on Ollama Cloud while whisper runs on a local Ollama server.
    const provider = process.env.TRANSCRIPTION_PROVIDER || process.env.LLM_PROVIDER || "mock";
    const baseUrl = (process.env.TRANSCRIPTION_BASE_URL || process.env.LLM_BASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.TRANSCRIPTION_API_KEY || process.env.LLM_API_KEY || "";

    if (provider === "mock") {
      return NextResponse.json({
        transcript: "This is a mock transcription. Configure a real LLM provider for actual voice input.",
      }, { headers: corsHeaders(request) });
    }

    if (provider === "ollama") {
      // Ollama transcribes on its native generate API. LLM_BASE_URL may be a raw
      // server (http://localhost:11434) or an OpenAI-compatible URL
      // (https://ollama.com/v1), so strip a trailing /v1 and send the API key
      // when the server requires auth.
      const nativeBase = baseUrl.replace(/\/v1$/, "");
      const transcriptionModel = process.env.TRANSCRIPTION_MODEL || "dimavz/whisper-tiny";
      const base64Audio = await blobToBase64(audio);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      try {
        const response = await fetch(`${nativeBase}/api/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: transcriptionModel,
            prompt: "Transcribe the following audio:",
            audio: base64Audio,
            stream: false,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          // "model not found" means the endpoint has no audio model. Ollama
          // Cloud, for example, serves no whisper model — that cannot be
          // fixed in code, so tell the user what to configure.
          if (/not found/i.test(errorText) || response.status === 404) {
            return NextResponse.json({
              transcript: "",
              message: `No audio model '${transcriptionModel}' on that endpoint. Run a local Ollama server and pull a whisper model (ollama pull ${transcriptionModel}), then set TRANSCRIPTION_BASE_URL (e.g. http://127.0.0.1:11434) and TRANSCRIPTION_PROVIDER=ollama.`,
            }, { status: 501, headers: corsHeaders(request) });
          }
          throw new Error(`Ollama transcription failed: ${response.status} ${errorText}`);
        }

        const data = await response.json() as { response?: string; error?: string };
        if (data.error) {
          return NextResponse.json({
            transcript: "",
            message: data.error,
          }, { headers: corsHeaders(request) });
        }

        return NextResponse.json({ transcript: data.response?.trim() || "" }, { headers: corsHeaders(request) });
      } catch {
        return NextResponse.json({
          transcript: "",
          message: `Voice transcription failed. Make sure ${transcriptionModel} is available: ollama pull ${transcriptionModel}`,
        }, { status: 500, headers: corsHeaders(request) });
      }
    }

    // OpenAI-compatible audio transcription endpoint
    if (!baseUrl || !apiKey) {
      return NextResponse.json({
        transcript: "",
        message: "Voice transcription requires TRANSCRIPTION_BASE_URL (or LLM_BASE_URL) and an API key to be configured.",
      }, { status: 503, headers: corsHeaders(request) });
    }

    const transcriptionModel = process.env.TRANSCRIPTION_MODEL || "whisper-1";
    // OpenAI-compatible providers expect `file` and `model` multipart fields.
    // Send a fresh FormData and let fetch set the boundary — the manual
    // "multipart/form-data" header without a boundary broke the request.
    const upload = new FormData();
    const fileName = typeof (audio as File).name === "string" && (audio as File).name ? (audio as File).name : "recording.webm";
    upload.append("file", audio, fileName);
    upload.append("model", transcriptionModel);

    try {
      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: upload,
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 404) {
          return NextResponse.json({
            transcript: "",
            message: `The transcription provider does not support audio transcription. Try the Web Speech API or type your answer.`,
          }, { headers: corsHeaders(request) });
        }
        throw new Error(`Transcription API returned ${response.status}: ${errorText}`);
      }

      const data = await response.json() as { text?: string };
      return NextResponse.json({ transcript: data.text?.trim() || "" }, { headers: corsHeaders(request) });
    } catch {
      return NextResponse.json({
        transcript: "",
        message: "Voice transcription failed. Try again or type your answer.",
      }, { status: 500, headers: corsHeaders(request) });
    }
  } catch {
    return jsonError(request, "Transcription failed.", 500, "TRANSCRIPTION_ERROR");
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  // Node runtime: the browser FileReader API does not exist here and would throw.
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}