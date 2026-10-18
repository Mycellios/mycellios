import { createHash } from "node:crypto";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST } from "../src/contracts/speech.js";
export function speechReply(text = "Hola", bytes = 60_000, options = { language: "en", voice: "af_heart", speed: 1 }) {
  const wav = Buffer.alloc(bytes, 1);
  wav.write("RIFF"); wav.writeUInt32LE(bytes - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(bytes - 44, 40);
  return { model: KOKORO_MODEL, tokenizer: "cl100k_base", input_tokens: 2,
    content: JSON.stringify({ schema: "mycellios-speech/1", text, ...options,
      audio: { format: "wav", sample_rate: 24000, duration_seconds: (bytes - 44) / 48000,
        sha256: createHash("sha256").update(wav).digest("hex"), data: wav.toString("base64") } }) };
}
export const health = { status: "ready", model: KOKORO_MODEL, runtime: "mycellios-kokoro/2",
  tokenizer: "cl100k_base", artifact_identity: KOKORO_WEIGHT_DIGEST };
