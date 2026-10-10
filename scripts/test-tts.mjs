import { createRequire } from "module";
import { writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");

const voice = process.argv[2] || "en-US-AriaNeural";
const text = process.argv[3] || "Hello. This is the Blueprint interviewer. Let us design a scalable system together.";

const tts = new MsEdgeTTS();
await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
  sentenceBoundaryEnabled: false,
  wordBoundaryEnabled: false,
});
const { audioStream } = tts.toStream(text, { rate: "-4%", pitch: "+2Hz" });
const chunks = [];
for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
const buffer = Buffer.concat(chunks);
writeFileSync("tts-test.mp3", buffer);
console.log(`voice=${voice} bytes=${buffer.length}`);
tts.close();
