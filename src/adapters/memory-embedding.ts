import { z } from "zod";
import { embeddingWorkerAdapterSchema } from "../contracts/embedding.js";
import {
  MAX_MEMORY_EMBEDDING_RESPONSE_BYTES, MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_DIMENSIONS,
  MEMORY_EMBEDDING_MAX_INPUT_TOKENS, MEMORY_EMBEDDING_MAX_INPUTS, MEMORY_EMBEDDING_MODEL,
  MEMORY_EMBEDDING_REVISION, MEMORY_EMBEDDING_RUNTIME, MEMORY_EMBEDDING_SCHEMA, MEMORY_EMBEDDING_UPSTREAM_MODEL,
  approvedMemoryEmbeddingExecution, parseMemoryEmbeddingRequest, verifiedMemoryEmbeddingEnvelope,
} from "../contracts/memory-embedding.js";
import type { ModelDeployment } from "../contracts/types.js";
import type { AdapterChunk, AdapterRequest, InferenceAdapter } from "./base.js";
import { boundedBody } from "./embedding.js";

/**
 * Worker adapter for the operator memory embedding replica. The loopback
 * runtime is `qwen06_embedding_service.py` with its `native` listener; it
 * shares the model with the private forwarder path. The adapter is ready only
 * while the runtime reports the pinned artifact, this activation and the
 * configured, approved device/precision; a GPU replica without a committed
 * placement reservation therefore reads as not ready.
 */
export class MemoryEmbeddingAdapter implements InferenceAdapter {
  readonly kind = "embedding" as const;
  private readonly baseUrl: URL;
  private readonly execution: { backend: string; precision: string };
  private ready = false;
  private checkedAt = 0;
  private readonly jobs = new Map<string, AbortController>();
  private readonly activationId: string;
  constructor(options: { baseUrl: string; model: string; modelDigest: string; activationId: string; execution: ModelDeployment["execution"] }) {
    const config = embeddingWorkerAdapterSchema.parse({ kind: this.kind, model: options.model, baseUrl: options.baseUrl });
    if (config.model !== MEMORY_EMBEDDING_MODEL || options.modelDigest !== MEMORY_EMBEDDING_DIGEST || !options.activationId) {
      throw new Error("memory_embedding_artifact_or_activation_missing");
    }
    const execution = approvedMemoryEmbeddingExecution(options.execution);
    if (!execution) throw new Error("memory_embedding_execution_not_approved");
    this.execution = execution;
    this.activationId = options.activationId;
    this.baseUrl = new URL(config.baseUrl);
  }
  async probe() {
    this.ready = false;
    this.checkedAt = Date.now();
    const response = await fetch(new URL("health", this.baseUrl), { signal: AbortSignal.timeout(5000), redirect: "error" });
    z.object({
      status: z.literal("ready"), model: z.literal(MEMORY_EMBEDDING_MODEL),
      upstream_model: z.literal(MEMORY_EMBEDDING_UPSTREAM_MODEL), revision: z.literal(MEMORY_EMBEDDING_REVISION),
      artifact_identity: z.literal(MEMORY_EMBEDDING_DIGEST), activation_id: z.literal(this.activationId),
      runtime: z.literal(MEMORY_EMBEDDING_RUNTIME), dimensions: z.literal(MEMORY_EMBEDDING_DIMENSIONS),
      max_inputs: z.literal(MEMORY_EMBEDDING_MAX_INPUTS), max_input_tokens: z.literal(MEMORY_EMBEDDING_MAX_INPUT_TOKENS),
      device: z.literal(this.execution.backend), dtype: z.literal(this.execution.precision),
    }).strict().parse(JSON.parse(await boundedBody(response, 8192)));
    this.ready = true;
    return { kind: this.kind, models: [MEMORY_EMBEDDING_MODEL], streaming: true, embeddings: true, reranking: false };
  }
  async warm(model: string) {
    if (model !== MEMORY_EMBEDDING_MODEL) throw new Error("memory_embedding_model_mismatch");
    await this.probe();
  }
  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    if (!this.ready) throw new Error("memory_embedding_runtime_not_ready");
    if (!input.lease?.id || !Number.isSafeInteger(input.lease.deadline) || input.lease.deadline <= Date.now()) throw new Error("memory_embedding_worker_lease_required");
    const request = parseMemoryEmbeddingRequest(input.request);
    const controller = new AbortController();
    this.jobs.set(input.jobId, controller);
    try {
      const response = await fetch(new URL("embed", this.baseUrl), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...request, schema: MEMORY_EMBEDDING_SCHEMA, lease: { jobId: input.jobId, id: input.lease.id,
          deadline: input.lease.deadline, activationId: this.activationId } }),
        redirect: "error", signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(305_000)]) });
      const result = verifiedMemoryEmbeddingEnvelope(await boundedBody(response, MAX_MEMORY_EMBEDDING_RESPONSE_BYTES), request);
      const content = JSON.stringify(result);
      for (let offset = 0, index = 0; offset < content.length; offset += 16_384, index++) {
        if (signal.aborted) throw signal.reason;
        if (controller.signal.aborted) throw controller.signal.reason;
        yield { index, text: content.slice(offset, offset + 16_384), metrics: { inputTokens: result.result.usage.prompt_tokens, outputTokens: 0 } };
      }
    } finally { this.jobs.delete(input.jobId); }
  }
  async cancel(jobId: string) { this.jobs.get(jobId)?.abort(new Error("Memory embedding cancelled")); }
  async metrics() {
    if (Date.now() - this.checkedAt >= 5000) {
      try { await this.probe(); } catch { this.ready = false; }
    }
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [MEMORY_EMBEDDING_MODEL] : [] };
  }
}
