// On-device Whisper transcription worker.
//
// Runs `@huggingface/transformers` in a Web Worker so the main thread never
// freezes while the model downloads or a recording is being transcribed.
//
// The page warms this worker up as soon as it mounts: a `preload` message
// starts the (first) model download in the background and the worker reports
// `ready` when the model can transcribe. The whisper model comes from the
// Hugging Face Hub and is cached by the browser, so afterwards it works
// offline — and nothing is ever sent to a server, so there are no quotas or
// API keys involved.
import { env, pipeline } from "@huggingface/transformers";

// English-only whisper, the smallest and fastest model that still reads a
// system-design interview answer well. For other languages/multilingual use
// "Xenova/whisper-tiny" instead.
const WHISPER_MODEL = "Xenova/whisper-tiny.en";

// Message protocol shared with the interview page.
export type WhisperRequest =
  | { action: "preload" }
  | { action: "transcribe"; id: number; audio: Float32Array };

export type WhisperResponse =
  | { action: "loading" }
  | { action: "ready" }
  | { action: "ready-failed"; error: string }
  | { action: "transcribe"; id: number; ok: true; text: string }
  | { action: "transcribe"; id: number; ok: false; error: string };

type Transcriber = (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>;

let transcriberPromise: Promise<Transcriber> | null = null;

// Load the model once, but reset the promise on failure so a later retry
// (e.g. after the network comes back) can download it again.
async function loadTranscriber(): Promise<Transcriber> {
  // The browser has no local model files — always load weights from the Hub
  // (and the Cache API will store them for offline reuse).
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  return (await pipeline("automatic-speech-recognition", WHISPER_MODEL)) as unknown as Transcriber;
}

function ensureTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = loadTranscriber().catch((error) => {
      transcriberPromise = null; // Allow a retry on the next request.
      throw error;
    });
  }
  return transcriberPromise;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.addEventListener("message", (event: MessageEvent<WhisperRequest>) => {
  const message = event.data;

  if (message.action === "preload") {
    // Background warm-up: kick off the (first) model download/load so a
    // recording made a few seconds after page load has almost no wait. The
    // page is told via `loading` (ack) and `ready` / `ready-failed`.
    self.postMessage({ action: "loading" } satisfies WhisperResponse);
    void ensureTranscriber()
      .then(() => self.postMessage({ action: "ready" } satisfies WhisperResponse))
      .catch((error) => self.postMessage({ action: "ready-failed", error: errorMessage(error) } satisfies WhisperResponse));
    return;
  }

  if (message.action === "transcribe") {
    const { id, audio } = message;
    void (async () => {
      let response: WhisperResponse;
      try {
        const transcriber = await ensureTranscriber();
        // Chunk long recordings so answers longer than 30s transcribe reliably.
        // A chunked transcription also keeps tiny on-device models from drowning.
        const output = await transcriber(audio, { chunk_length_s: 30, stride_length_s: 5 });
        response = { action: "transcribe", id, ok: true, text: output?.text ?? "" };
      } catch (error) {
        response = { action: "transcribe", id, ok: false, error: errorMessage(error) };
      }
      self.postMessage(response);
    })();
  }
});