import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelDeployment } from "./types.js";

export const TRANSCRIPTION_MODEL = "mycellios-whisper-small";
export const TRANSCRIPTION_REVISION = "973afd24965f72e36ca33b3055d56a652f456b4d";
export const TRANSCRIPTION_DIGEST = "sha256:1d7734884874f1a1513ed9aa760a4f8e97aaa02fd6d93a3a85d27b2ae9ca596b";
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 960_044;
export const MAX_TRANSCRIPTION_TOKENS = 1024;
export const MAX_TRANSCRIPTION_RESULT_BYTES = 32_768;
export const TRANSCRIPTION_CANARY_SHA256 = "3f74b5c9b9bcfdb02d42dc4dd5df8d0ba2eb18e2bc0de96f692eab21ec98b27a";
export const transcriptionInputSchema = z.object({
  schema: z.literal("mycellios-transcription-input/1"),
  audio: z.object({ format: z.literal("wav"), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.string().min(64).max(Math.ceil(MAX_TRANSCRIPTION_AUDIO_BYTES / 3) * 4) }).strict(),
  language: z.enum(["es", "en", "auto"]).default("auto"),
}).strict();
export type TranscriptionInput = z.infer<typeof transcriptionInputSchema>;

/** Canonical PCM avoids accepting compressed-media decoders in the worker. */
export function transcriptionAudio(input: TranscriptionInput): Buffer {
  const audio = Buffer.from(input.audio.data, "base64");
  if (audio.length < 46 || audio.length > MAX_TRANSCRIPTION_AUDIO_BYTES || audio.length % 2
    || audio.toString("base64") !== input.audio.data
    || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 16) !== "WAVEfmt "
    || audio.readUInt32LE(4) !== audio.length - 8 || audio.readUInt32LE(16) !== 16
    || audio.readUInt16LE(20) !== 1 || audio.readUInt16LE(22) !== 1
    || audio.readUInt32LE(24) !== 16_000 || audio.readUInt32LE(28) !== 32_000
    || audio.readUInt16LE(32) !== 2 || audio.readUInt16LE(34) !== 16
    || audio.toString("ascii", 36, 40) !== "data" || audio.readUInt32LE(40) !== audio.length - 44
    || createHash("sha256").update(audio).digest("hex") !== input.audio.sha256) {
    throw new Error("transcription_audio_integrity_failed");
  }
  return audio;
}
export function parseTranscriptionRequest(request: { model: string; messages: ReadonlyArray<{ role: string; content: string }> }): TranscriptionInput {
  if (request.model !== TRANSCRIPTION_MODEL || request.messages.length !== 1 || request.messages[0]?.role !== "user") {
    throw new Error("transcription_requires_one_audio_envelope");
  }
  const input = transcriptionInputSchema.parse(JSON.parse(request.messages[0].content));
  transcriptionAudio(input);
  return input;
}
const resultSchema = z.object({
  schema: z.literal("mycellios-transcription/1"), model: z.literal(TRANSCRIPTION_MODEL),
  audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  language: z.enum(["es", "en"]), requested_language: z.enum(["es", "en", "auto"]),
  text: z.string().trim().min(1).max(8192),
  usage: z.object({ input_tokens: z.number().int().positive().max(MAX_TRANSCRIPTION_TOKENS),
    output_tokens: z.literal(0), tokenizer: z.literal("cl100k_base") }).strict(),
}).strict();
export function verifiedTranscriptionEnvelope(content: string, input: TranscriptionInput) {
  if (Buffer.byteLength(content) > MAX_TRANSCRIPTION_RESULT_BYTES) throw new Error("transcription_response_limit");
  const result = resultSchema.parse(JSON.parse(content));
  if (result.audio_sha256 !== input.audio.sha256 || result.requested_language !== input.language
    || (input.language !== "auto" && result.language !== input.language)) throw new Error("transcription_response_binding_failed");
  return result;
}
export const transcriptionWorkerAdapterSchema = z.object({
  kind: z.literal("transcription"), model: z.literal(TRANSCRIPTION_MODEL),
  baseUrl: z.string().url().refine(value => {
    const u = new URL(value);
    return u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname)
      && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
  }, "Transcription requires a credential-free loopback origin"),
}).strict();
export function isTranscriptionDeployment(d: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined) {
  return d?.adapter === "transcription" && d.model === TRANSCRIPTION_MODEL && d.modelDigest === TRANSCRIPTION_DIGEST;
}
