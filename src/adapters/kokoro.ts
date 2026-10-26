import { z } from "zod";
import {
  KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, MAX_SPEECH_BYTES,
  MAX_SPEECH_RESPONSE_BYTES, kokoroWorkerAdapterSchema, verifiedSpeechEnvelope, resolveSpeechOptions,
} from "../contracts/speech.js";
import { AdapterError, type AdapterCapabilities, type AdapterChunk, type AdapterRequest, type InferenceAdapter } from "./base.js";

const replySchema = z.object({
  model: z.literal(KOKORO_MODEL),
  content: z.string().min(1).max(MAX_SPEECH_RESPONSE_BYTES),
  input_tokens: z.number().int().positive().max(10_000),
  tokenizer: z.literal("cl100k_base"),
});
export class KokoroAdapter implements InferenceAdapter {
  readonly kind = "kokoro" as const;
  private readonly baseUrl: URL;
  private ready = false;
  private checkedAt = 0;
  private inFlightProbe: Promise<AdapterCapabilities> | null = null;
  private readonly jobs = new Map<string, AbortController>();
  constructor(options: { baseUrl: string; model: string; modelDigest: string }) {
    const config = kokoroWorkerAdapterSchema.parse({ kind: this.kind, model: options.model, baseUrl: options.baseUrl });
    if (options.modelDigest !== KOKORO_WEIGHT_DIGEST) throw new Error("kokoro_model_digest_mismatch");
    this.baseUrl = new URL(config.baseUrl);
  }
  probe(): Promise<AdapterCapabilities> {
    this.inFlightProbe ??= this.probeOnce().finally(() => { this.inFlightProbe = null; });
    return this.inFlightProbe;
  }
  private async probeOnce() {
    this.ready = false;
    this.checkedAt = Date.now();
    const response = await fetch(new URL("health", this.baseUrl), {
      signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    const health = z.object({
      status: z.literal("ready"), model: z.literal(KOKORO_MODEL),
      artifact_identity: z.literal(KOKORO_WEIGHT_DIGEST),
      runtime: z.literal("mycellios-kokoro/2"), tokenizer: z.literal("cl100k_base"),
    }).parse(JSON.parse(await boundedBody(response, 4096)));
    this.ready = health.status === "ready";
    return { kind: this.kind, models: [KOKORO_MODEL], streaming: true, embeddings: false, reranking: false };
  }
  async warm(model: string) {
    if (model !== KOKORO_MODEL) throw new Error("kokoro_model_mismatch");
    await this.probe();
  }
  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    if (input.request.model !== KOKORO_MODEL) throw new Error("kokoro_not_ready_or_model_mismatch");
    signal.throwIfAborted();
    try { await this.probe(); } catch { throw new Error("kokoro_not_ready_or_model_mismatch"); }
    signal.throwIfAborted();
    if (input.lease && input.lease.deadline <= Date.now()) throw new Error("kokoro_worker_lease_expired");
    const users = input.request.messages.filter((message) => message.role === "user");
    if (users.length !== 1 || input.request.messages.some((m) => !["user", "system", "developer"].includes(m.role))) {
      throw new AdapterError("Speech requires one user text, without conversation history", "invalid_speech_request", false);
    }
    const text = users[0]!.content;
    const options = resolveSpeechOptions(input.request);
    if (!text.trim() || [...text].length > 400) throw new Error("kokoro_text_limit_exceeded");
    const controller = new AbortController();
    this.jobs.set(input.jobId, controller);
    try {
      const response = await fetch(new URL("synthesize", this.baseUrl), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...options }), redirect: "error",
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]),
      });
      const result = replySchema.parse(JSON.parse(await boundedBody(response, MAX_SPEECH_RESPONSE_BYTES)));
      verifiedSpeechEnvelope(result.content, text, options);
      for (let offset = 0, index = 0; offset < result.content.length; offset += 16_384, index++) {
        if (signal.aborted) throw signal.reason;
        yield { index, text: result.content.slice(offset, offset + 16_384),
          metrics: { inputTokens: result.input_tokens, outputTokens: 0 } };
      }
    } finally {
      this.jobs.delete(input.jobId);
    }
  }
  async cancel(jobId: string) { this.jobs.get(jobId)?.abort(new Error("Speech cancelled")); }
  async metrics() {
    if (Date.now() - this.checkedAt >= 5000) { try { await this.probe(); } catch { this.ready = false; } }
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [KOKORO_MODEL] : [] };
  }
}
async function boundedBody(response: Response, maximum: number): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AdapterError("Kokoro runtime returned HTTP " + response.status, "kokoro_runtime_failed", response.status >= 500 || response.status === 429);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("kokoro_response_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
