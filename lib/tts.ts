import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { Readable } from "stream";

/**
 * Server-side neural text-to-speech built on the free Microsoft Edge
 * "Read Aloud" endpoint. This gives us high-quality natural voices without an
 * API key and without depending on Google's speech servers, which are
 * unreachable from some regions.
 */
export const DEFAULT_TTS_VOICE = "en-US-AriaNeural";

export interface TTSVoiceOption {
  id: string;
  label: string;
  gender: "Female" | "Male";
}

/** A curated allow-list. Voice names are injected into SSML, so we never accept arbitrary values. */
export const TTS_VOICES: TTSVoiceOption[] = [
  { id: "en-US-AriaNeural", label: "Aria · US female (warm)", gender: "Female" },
  { id: "en-US-JennyNeural", label: "Jenny · US female (friendly)", gender: "Female" },
  { id: "en-US-EmmaNeural", label: "Emma · US female (bright)", gender: "Female" },
  { id: "en-US-AvaNeural", label: "Ava · US female (clear)", gender: "Female" },
  { id: "en-US-GuyNeural", label: "Guy · US male (calm)", gender: "Male" },
  { id: "en-US-AndrewNeural", label: "Andrew · US male (confident)", gender: "Male" },
  { id: "en-US-BrianNeural", label: "Brian · US male (casual)", gender: "Male" },
  { id: "en-GB-SoniaNeural", label: "Sonia · UK female", gender: "Female" },
  { id: "en-GB-RyanNeural", label: "Ryan · UK male", gender: "Male" },
  { id: "en-IN-NeerjaNeural", label: "Neerja · Indian English female", gender: "Female" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat · Indian English male", gender: "Male" },
];

const VOICE_IDS = new Set(TTS_VOICES.map((voice) => voice.id));
const MAX_TEXT_LENGTH = 1500;
const SYNTHESIS_TIMEOUT_MS = 15000;
const MAX_CACHE_ENTRIES = 64;

const cache = new Map<string, Buffer>();

export function isSupportedVoice(value: unknown): value is string {
  return typeof value === "string" && VOICE_IDS.has(value);
}

export function resolveVoice(value: unknown): string {
  return isSupportedVoice(value) ? value : DEFAULT_TTS_VOICE;
}

/** Strip control characters, collapse runaway whitespace, and bound the length. */
export function sanitizeSpeechText(input: unknown): string {
  if (typeof input !== "string") return "";
  const cleaned = input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .trim();
  return cleaned.slice(0, MAX_TEXT_LENGTH);
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      stream.destroy();
      reject(new Error("TTS synthesis timed out"));
    }, SYNTHESIS_TIMEOUT_MS);
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    stream.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Synthesize `text` with a neural voice and return an MP3 buffer.
 * Results are memoized in-process so repeated interviewer lines are instant.
 */
export async function synthesizeSpeech(text: string, voice: string): Promise<Buffer> {
  const key = `${voice}::${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      sentenceBoundaryEnabled: false,
      wordBoundaryEnabled: false,
    });
    const { audioStream } = tts.toStream(text, { rate: "-4%", pitch: "+1Hz" });
    const buffer = await streamToBuffer(audioStream);
    if (buffer.length === 0) throw new Error("TTS returned empty audio");

    cache.set(key, buffer);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return buffer;
  } finally {
    tts.close();
  }
}
