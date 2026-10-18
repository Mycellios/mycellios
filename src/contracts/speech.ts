import { createHash } from "node:crypto";
import type { ModelDeployment } from "./types.js";
import { z } from "zod";
export const KOKORO_MODEL = "mycellios-kokoro-es";
export const KOKORO_WEIGHT_DIGEST = "sha256:496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4";
export const SPEECH_VOICES = ["af_heart", "am_michael", "ef_dora", "em_alex", "em_santa"] as const;
export const speechOptionsSchema = z.object({
  language: z.enum(["en", "es"]).optional(),
  voice: z.enum(SPEECH_VOICES).optional(),
  speed: z.number().min(0.5).max(2).optional(),
}).strict();
export function resolveSpeechOptions(input: { language?: string | undefined; voice?: string | undefined; speed?: number | undefined }) {
  const options = speechOptionsSchema.parse({ language: input.language, voice: input.voice, speed: input.speed });
  const language = options.language ?? "en";
  const voice = options.voice ?? (language === "en" ? "af_heart" : "ef_dora");
  if (!voice.startsWith(language === "en" ? "a" : "e")) throw new Error("speech_voice_language_mismatch");
  return { language, voice, speed: options.speed ?? 1 };
}
export const MAX_SPEECH_BYTES = 1_048_576;
export const MAX_SPEECH_RESPONSE_BYTES = 1_500_000;
export const speechEnvelopeSchema = z.object({
  schema: z.literal("mycellios-speech/1"),
  text: z.string().min(1).max(400),
  voice: z.enum(SPEECH_VOICES),
  language: z.enum(["en", "es"]).optional(),
  speed: z.number().min(0.5).max(2).optional(),
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
export function verifiedSpeechEnvelope(content: string, text: string, expected?: ReturnType<typeof resolveSpeechOptions>) {
  const envelope = speechEnvelopeSchema.parse(JSON.parse(content));
  if (envelope.text !== text) throw new Error("kokoro_response_text_mismatch");
  if (expected && (envelope.voice !== expected.voice || envelope.language !== expected.language || envelope.speed !== expected.speed)) {
    throw new Error("kokoro_response_options_mismatch");
  }
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
