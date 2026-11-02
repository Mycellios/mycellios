import { z } from "zod";
import { EMBEDDING_DIGEST, EMBEDDING_MODEL, EMBEDDING_REVISION, MAX_EMBEDDING_RESPONSE_BYTES, embeddingWorkerAdapterSchema, parseEmbeddingRequest, verifiedEmbeddingEnvelope } from "../contracts/embedding.js";
import { AdapterError, type AdapterChunk, type AdapterRequest, type InferenceAdapter } from "./base.js";

export class EmbeddingAdapter implements InferenceAdapter {
  readonly kind = "embedding" as const;
  private readonly baseUrl: URL;
  private ready = false;
  private checkedAt = 0;
  private readonly jobs = new Map<string, AbortController>();
  constructor(options: { baseUrl: string; model: string; modelDigest: string; activationId: string }) {
    const config = embeddingWorkerAdapterSchema.parse({ kind: this.kind, model: options.model, baseUrl: options.baseUrl });
    if (options.modelDigest !== EMBEDDING_DIGEST || !options.activationId) throw new Error("embedding_artifact_or_activation_missing");
    this.options = options;
    this.baseUrl = new URL(config.baseUrl);
  }
  private readonly options: { activationId: string };
  async probe() {
    this.ready = false;
    this.checkedAt = Date.now();
    const response = await fetch(new URL("health", this.baseUrl), { signal: AbortSignal.timeout(5000), redirect: "error" });
    const health = z.object({ status: z.literal("ready"), model: z.literal(EMBEDDING_MODEL), revision: z.literal(EMBEDDING_REVISION),
      artifact_identity: z.literal(EMBEDDING_DIGEST), activation_id: z.literal(this.options.activationId),
      runtime: z.literal("mycellios-embedding-pipeline/1"), max_input_tokens: z.literal(2048),
      compute: z.literal("float32"), storage: z.literal("bfloat16"),
      stages: z.array(z.object({ node_id: z.string().min(1), layer_start: z.number().int().nonnegative(), layer_end: z.number().int().positive(),
        backend: z.literal("cpu"), precision: z.literal("bfloat16"), package_sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(2),
    }).parse(JSON.parse(await boundedBody(response, 8192)));
    const [first, last] = health.stages;
    if (first!.node_id === last!.node_id || first!.layer_start !== 0 || first!.layer_end !== 15 || last!.layer_start !== 15 || last!.layer_end !== 36
      || first!.package_sha256 !== "278f26db5ee6e540a5e4e0d88ebca6222530b204b9b164721670d589d151b887"
      || last!.package_sha256 !== "95b9900b4c5ff61d015447f6ba0add02ba4cfe1c1d6a3a674bc041856f34018a") throw new Error("embedding_route_identity_mismatch");
    this.ready = true;
    return { kind: this.kind, models: [EMBEDDING_MODEL], streaming: true, embeddings: true, reranking: false };
  }
  async warm(model: string) {
    if (model !== EMBEDDING_MODEL) throw new Error("embedding_model_mismatch");
    await this.probe();
  }
  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    if (!this.ready) throw new Error("embedding_runtime_not_ready");
    if (!input.lease?.id || !Number.isSafeInteger(input.lease.deadline) || input.lease.deadline <= Date.now()) throw new Error("embedding_worker_lease_required");
    const request = parseEmbeddingRequest(input.request);
    const controller = new AbortController();
    this.jobs.set(input.jobId, controller);
    try {
      const response = await fetch(new URL("embed", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, lease: { jobId: input.jobId, id: input.lease.id,
          deadline: input.lease.deadline, activationId: this.options.activationId } }),
        redirect: "error", signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(305_000)]) });
      const result = verifiedEmbeddingEnvelope(await boundedBody(response, MAX_EMBEDDING_RESPONSE_BYTES), request);
      const content = JSON.stringify(result);
      for (let offset = 0, index = 0; offset < content.length; offset += 16_384, index++) {
        if (signal.aborted) throw signal.reason;
        if (controller.signal.aborted) throw controller.signal.reason;
        yield { index, text: content.slice(offset, offset + 16_384), metrics: { inputTokens: result.result.usage.prompt_tokens, outputTokens: 0 } };
      }
    } finally { this.jobs.delete(input.jobId); }
  }
  async cancel(jobId: string) { this.jobs.get(jobId)?.abort(new Error("Embedding cancelled")); }
  async metrics() {
    if (Date.now() - this.checkedAt >= 5000) {
      try { await this.probe(); } catch { this.ready = false; }
    }
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [EMBEDDING_MODEL] : [] };
  }
}
async function boundedBody(response: Response, maximum: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AdapterError("Embedding runtime HTTP " + response.status, "embedding_runtime_failed", response.status >= 500 || response.status === 429);
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maximum) throw new Error("embedding_response_too_large"); chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
