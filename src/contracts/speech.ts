import { createHash } from "node:crypto";
import type { ModelDeployment } from "./types.js";
import { z } from "zod";
export const KOKORO_MODEL = "mycellios-kokoro-es";
export const KOKORO_WEIGHT_DIGEST = "sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4";
export const MAX_SPEECH_BYTES = 1_048_576;
export const MAX_SPEECH_RESPONSE_BYTES = 1_500_000;
export const speechEnvelopeSchema = z.object({
  schema: z.literal("mycellios-speech/1"),
  text: z.string().min(1).max(400),
  voice: z.enum(["ef_dora", "em_alex", "em_santa"]),
  audio: z.object({
    format: z.literal("wav"),
    sample_rate: z.literal(24_000),
    duration_seconds: z.number().positive().max(22),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    data: z.string().min(64).max(Math.ceil(MAX_SPEECH_BYTES / 3) * 4),
  }).strict(),
}).strict();
export const kokoroWorkerAdapterSchema = z.object({
  kind: z.literal("kokoro"),
  model: z.literal(KOKORO_MODEL),
  baseUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  }, "Kokoro requires a credential-free HTTP loopback origin with a trailing slash"),
}).strict();
export function isKokoroDeployment(deployment: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined): boolean {
  return deployment?.adapter === "kokoro" && deployment.model === KOKORO_MODEL && deployment.modelDigest === KOKORO_WEIGHT_DIGEST;
}
export function verifiedSpeechEnvelope(content: string, text: string) {
  const envelope = speechEnvelopeSchema.parse(JSON.parse(content));
  if (envelope.text !== text) throw new Error("kokoro_response_text_mismatch");
  const audio = Buffer.from(envelope.audio.data, "base64");
  if (audio.length > MAX_SPEECH_BYTES || audio.length < 46
    || audio.toString("base64") !== envelope.audio.data
    || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 16) !== "WAVEfmt "
    || audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16
    || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
    || audio.readUInt32LE(24) !== 24_000 || audio.readUInt16LE(34) !== 16
    || audio.toString("ascii", 36, 40) !== "data" || audio.readUInt32LE(40) !== audio.length - 44
    || Math.abs(envelope.audio.duration_seconds - (audio.length - 44) / 48_000) > 0.001
    || createHash("sha256").update(audio).digest("hex") !== envelope.audio.sha256) {
    throw new Error("kokoro_audio_integrity_failed");
  }
  return envelope;
}
