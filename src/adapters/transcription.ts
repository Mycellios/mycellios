import { z } from "zod";
import { TRANSCRIPTION_MODEL, TRANSCRIPTION_DIGEST, MAX_TRANSCRIPTION_RESULT_BYTES, transcriptionWorkerAdapterSchema, parseTranscriptionRequest, verifiedTranscriptionEnvelope } from "../contracts/transcription.js";
import { AdapterError, type AdapterCapabilities, type AdapterChunk, type AdapterRequest, type InferenceAdapter } from "./base.js";

const replySchema = z.object({
  model: z.literal(TRANSCRIPTION_MODEL),
  content: z.string().min(1).max(MAX_TRANSCRIPTION_RESULT_BYTES),
  input_tokens: z.number().int().positive().max(10_000),
  tokenizer: z.literal("cl100k_base"),
});
export class TranscriptionAdapter implements InferenceAdapter {
  readonly kind = "transcription" as const;
  private readonly baseUrl: URL;
  private ready = false;
  private checkedAt = 0;
  private inFlightProbe: Promise<AdapterCapabilities> | null = null;
  private readonly jobs = new Map<string, AbortController>();
  constructor(options: { baseUrl: string; model: string; modelDigest: string }) {
    const config = transcriptionWorkerAdapterSchema.parse({ kind: this.kind, model: options.model, baseUrl: options.baseUrl });
    if (options.modelDigest !== TRANSCRIPTION_DIGEST) throw new Error("transcription_model_digest_mismatch");
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
      status: z.literal("ready"), model: z.literal(TRANSCRIPTION_MODEL),
      artifact_identity: z.literal(TRANSCRIPTION_DIGEST),
      runtime: z.literal("mycellios-transcription-runtime/1"), tokenizer: z.literal("cl100k_base"),
    }).parse(JSON.parse(await boundedBody(response, 4096)));
    this.ready = health.status === "ready";
    return { kind: this.kind, models: [TRANSCRIPTION_MODEL], streaming: true, embeddings: false, reranking: false };
  }
  async warm(model: string) {
    if (model !== TRANSCRIPTION_MODEL) throw new Error("transcription_model_mismatch");
    await this.probe();
  }
  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    if (input.request.model !== TRANSCRIPTION_MODEL) throw new Error("transcription_not_ready_or_model_mismatch");
    signal.throwIfAborted();
    try { await this.probe(); } catch { throw new Error("transcription_not_ready_or_model_mismatch"); }
    signal.throwIfAborted();
    if (input.lease && input.lease.deadline <= Date.now()) throw new Error("transcription_worker_lease_expired");
    const request = parseTranscriptionRequest(input.request);
    const controller = new AbortController();
    this.jobs.set(input.jobId, controller);
    try {
      const response = await fetch(new URL("transcribe", this.baseUrl), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(request), redirect: "error",
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]),
      });
      const result = replySchema.parse(JSON.parse(await boundedBody(response, MAX_TRANSCRIPTION_RESULT_BYTES)));
      const envelope = verifiedTranscriptionEnvelope(result.content, request);
      if (result.input_tokens !== envelope.usage.input_tokens) throw new Error("transcription_usage_mismatch");
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
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [TRANSCRIPTION_MODEL] : [] };
  }
}
async function boundedBody(response: Response, maximum: number): Promise<string> {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AdapterError("Transcription runtime returned HTTP " + response.status, "transcription_runtime_failed", response.status >= 500 || response.status === 429);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) throw new Error("transcription_response_too_large");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
