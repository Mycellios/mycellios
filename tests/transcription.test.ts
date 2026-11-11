import type { ChatCompletionRequest } from "../src/contracts/types.js";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { transcriptionAudio, parseTranscriptionRequest, verifiedTranscriptionEnvelope,
  TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST, MAX_TRANSCRIPTION_TOKENS } from "../src/contracts/transcription.js";
import { chatCompletionRequestSchema, deploymentSchema, workerConfigSchema } from "../src/contracts/schemas.js";
import { estimateInputTokens } from "../src/core/request.js";
import { TranscriptionAdapter } from "../src/adapters/transcription.js";
import { createCoordinator } from "../src/coordinator/server.js";
import { resolve } from "node:path";

function wav() {
  const a = Buffer.alloc(32044); a.write("RIFF"); a.writeUInt32LE(a.length - 8, 4); a.write("WAVEfmt ", 8);
  a.writeUInt32LE(16, 16); a.writeUInt16LE(1, 20); a.writeUInt16LE(1, 22); a.writeUInt32LE(16000, 24);
  a.writeUInt32LE(32000, 28); a.writeUInt16LE(2, 32); a.writeUInt16LE(16, 34); a.write("data", 36); a.writeUInt32LE(a.length - 44, 40);
  return a;
}
function input(audio = wav()) { return { schema: "mycellios-transcription-input/1" as const, language: "es" as const,
  audio: { format: "wav" as const, sha256: createHash("sha256").update(audio).digest("hex"), data: audio.toString("base64") } }; }
function request() { return chatCompletionRequestSchema.parse({ model: TRANSCRIPTION_MODEL, messages: [{ role: "user", content: JSON.stringify(input()) }], max_tokens: 1 }) as ChatCompletionRequest; }
describe("bounded network transcription", () => {
  it("rejects implicit legacy funding before creating a job", async () => {
    const runtime = await createCoordinator({ host: "127.0.0.1", port: 0, requestTimeoutMs: 60000, databasePath: ":memory:",
      allowDevelopmentAdapters: false, mobileAssetsPath: resolve("tests/fixtures/mobile-assets"),
      landingAssetsPath: resolve("tests/fixtures/landing-assets") });
    try {
      const response = await runtime.app.inject({ method: "POST", url: "/v1/chat/completions", payload: request() });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("transcription_funding_required");
      expect(await runtime.store.listNonterminalJobs()).toHaveLength(0);
    } finally { await runtime.close(); }
  });
  it("accepts PCM and binds its digest; audio bytes do not become scheduling tokens", () => {
    const r = request(); expect(transcriptionAudio(parseTranscriptionRequest(r))).toEqual(wav());
    expect(estimateInputTokens(r)).toBe(MAX_TRANSCRIPTION_TOKENS);
  });
  it.each([4, 20, 22, 24, 28, 32, 34, 40])("rejects corrupt WAV header at %i even with a matching content hash", offset => {
    const a = wav(); a[offset] = a[offset]! ^ 1; expect(() => transcriptionAudio(input(a))).toThrow();
  });
  it("rejects mismatched audio, compressed media, oversized clips and history before admission", () => {
    const i = input(); i.audio.sha256 = "0".repeat(64); expect(() => transcriptionAudio(i)).toThrow();
    expect(() => transcriptionAudio(input(Buffer.alloc(960046)))).toThrow();
    expect(() => parseTranscriptionRequest({ ...request(), messages: [{ role: "assistant", content: "history" }, ...request().messages] })).toThrow();
  });
  it("rejects a transcript bound to another audio or language and invalid usage", () => {
    const i = input(); const result = { schema: "mycellios-transcription/1", model: TRANSCRIPTION_MODEL,
      audio_sha256: i.audio.sha256, requested_language: "es", language: "es", text: "Hola mundo.",
      usage: { input_tokens: 3, output_tokens: 0, tokenizer: "cl100k_base" } };
    expect(verifiedTranscriptionEnvelope(JSON.stringify(result), i).text).toBe("Hola mundo.");
    for (const patch of [{ audio_sha256: "0".repeat(64) }, { language: "en" }, { requested_language: "auto" }, { text: "" }, { usage: { ...result.usage, output_tokens: 1 } }]) {
      expect(() => verifiedTranscriptionEnvelope(JSON.stringify({ ...result, ...patch }), i)).toThrow();
    }
  });
  it("admits only the pinned artifact, native activation and loopback runtime", () => {
    expect(() => new TranscriptionAdapter({ baseUrl: "https://example.com/", model: TRANSCRIPTION_MODEL, modelDigest: TRANSCRIPTION_DIGEST })).toThrow();
    const d = { adapter: "transcription", model: TRANSCRIPTION_MODEL, modelDigest: TRANSCRIPTION_DIGEST, activationId: "activation-1",
      deploymentId: "asr-1", mode: "replica", peakVramMb: 1536, contextLimit: 4096, maxConcurrency: 1, freeSlots: 1,
      tokensPerSecond: 1, throughputSource: "default", ttftMs: 5000, dataLocality: "local" };
    expect(deploymentSchema.safeParse(d).success).toBe(true);
    expect(deploymentSchema.safeParse({ ...d, verificationState: "verified" }).success).toBe(false);
    expect(deploymentSchema.safeParse({ ...d, modelDigest: "sha256:" + "0".repeat(64) }).success).toBe(false);
    expect(workerConfigSchema.safeParse({ region: "es", offeredVramMb: 2048, capacityScope: "cell", limits: { maxConcurrency: 1 },
      adapter: { kind: "transcription", model: TRANSCRIPTION_MODEL, baseUrl: "http://127.0.0.1:8892/" },
      deployment: { modelDigest: TRANSCRIPTION_DIGEST, activationId: "a", peakVramMb: 1536, contextLimit: 4096 } }).success).toBe(true);
  });
});
