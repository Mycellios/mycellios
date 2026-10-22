import { z } from "zod";
import { lstatSync, readFileSync } from "node:fs";
import { DECISION_CONTEXT_LIMIT, DECISION_DEADLINE_MS, DECISION_DIGEST, DECISION_MODEL, DECISION_REVISION, DECISION_TOKENIZER_SHA256,
  MAX_DECISION_RESPONSE_BYTES, decisionWorkerAdapterSchema, parseDecisionRequest, verifiedDecisionEnvelope } from "../contracts/decision.js";
import { AdapterError, type AdapterChunk, type AdapterRequest, type InferenceAdapter } from "./base.js";

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const healthSchema = z.object({ status: z.literal("ready"), runtime: z.literal("mycellios-decision-pipeline/1"),
  qualification_only: z.literal(false), model: z.literal(DECISION_MODEL), revision: z.literal(DECISION_REVISION),
  artifact_identity: z.literal(DECISION_DIGEST), activation_id: z.string().min(1), max_input_tokens: z.literal(DECISION_CONTEXT_LIMIT),
  tokenizer_sha256: z.literal(DECISION_TOKENIZER_SHA256),
  // Identity here must be bound by native admission, not by a client hostname.
  stages: z.array(z.object({ node_id: z.string().min(1), physical_identity: sha, layer_start: z.number().int(),
    layer_end: z.number().int(), backend: z.literal("cpu"), shard_sha256: sha }).strict()).length(3),
}).strict();
const shards = ["1ea5b923a3359eb3d6ecd683792b6723795c8d2fdf3d2a31d50219bf109dc325",
  "02df8d07f3d7c7e47829cbb55d73c4a18d39096a5ed030f97333be9c7a64a6a5",
  "23fd6d438241135c4a23dab917dc81691d361ffca786aa84b7c1bc6dc23d6e35"];
const boundaries = [0, 8, 20, 32];

export function decisionRuntimeToken(): string {
  const path = process.env.MYCELLIOS_DECISION_RUNTIME_TOKEN_FILE;
  if (!path) throw new Error("decision_runtime_token_file_required");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256
    || process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("decision_runtime_token_file_unsafe");
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{64,128}$/.test(token)) throw new Error("decision_runtime_token_invalid");
  return token;
}

export class DecisionAdapter implements InferenceAdapter {
  readonly kind = "decision" as const;
  private readonly baseUrl: URL;
  private ready = false;
  private checkedAt = 0;
  private readonly jobs = new Map<string, { controller: AbortController; leaseId: string }>();
  constructor(private readonly options: { baseUrl: string; model: string; modelDigest: string; activationId: string; runtimeToken: string }) {
    const config = decisionWorkerAdapterSchema.parse({ kind: this.kind, model: options.model, baseUrl: options.baseUrl });
    if (options.modelDigest !== DECISION_DIGEST || !options.activationId) throw new Error("decision_artifact_or_activation_missing");
    if (!/^[A-Za-z0-9_-]{64,128}$/.test(options.runtimeToken)) throw new Error("decision_runtime_token_invalid");
    this.baseUrl = new URL(config.baseUrl);
  }
  async probe() {
    this.ready = false; this.checkedAt = Date.now();
    const response = await fetch(new URL("health", this.baseUrl), { headers: { authorization: "Bearer " + this.options.runtimeToken },
      signal: AbortSignal.timeout(5000), redirect: "error" });
    const health = healthSchema.parse(JSON.parse(await boundedBody(response, 8192)));
    if (health.activation_id !== this.options.activationId
      || new Set(health.stages.map((s) => s.node_id)).size !== 3
      || new Set(health.stages.map((s) => s.physical_identity)).size !== 3
      || health.stages.some((stage, i) => stage.layer_start !== boundaries[i] || stage.layer_end !== boundaries[i + 1]
        || stage.shard_sha256 !== shards[i])) throw new Error("decision_route_identity_mismatch");
    this.ready = true;
    return { kind: this.kind, models: [DECISION_MODEL], streaming: true, embeddings: false, reranking: false };
  }
  async warm(model: string) { if (model !== DECISION_MODEL) throw new Error("decision_model_mismatch"); await this.probe(); }
  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    if (!this.ready) throw new Error("decision_runtime_not_ready");
    if (!input.lease?.id || !Number.isSafeInteger(input.lease.deadline) || input.lease.deadline <= Date.now()) throw new Error("decision_worker_lease_required");
    const request = parseDecisionRequest(input.request), controller = new AbortController();
    if (this.jobs.size) throw new AdapterError("Decision cell is busy", "decision_cell_busy", true);
    this.jobs.set(input.jobId, { controller, leaseId: input.lease.id });
    let verified = false;
    try {
      const response = await fetch(new URL("decide", this.baseUrl), { method: "POST", headers: { "content-type": "application/json",
        authorization: "Bearer " + this.options.runtimeToken },
        body: JSON.stringify({ ...request, lease: { jobId: input.jobId, id: input.lease.id,
          deadline: input.lease.deadline, activationId: this.options.activationId } }), redirect: "error",
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(Math.max(1, Math.min(DECISION_DEADLINE_MS, input.lease.deadline - Date.now())))]) });
      const result = verifiedDecisionEnvelope(await boundedBody(response, MAX_DECISION_RESPONSE_BYTES), request);
      if (signal.aborted) throw signal.reason;
      if (controller.signal.aborted) throw controller.signal.reason;
      verified = true;
      yield { index: 0, text: JSON.stringify(result), metrics: { inputTokens: result.usage.prompt_tokens, outputTokens: 0 } };
    } finally {
      if (!verified || signal.aborted || controller.signal.aborted) await this.sendCancel(input.jobId, input.lease.id);
      this.jobs.delete(input.jobId);
    }
  }
  private async sendCancel(jobId: string, leaseId: string) {
    try {
      const response = await fetch(new URL("cancel", this.baseUrl), { method: "POST", redirect: "error",
        headers: { "content-type": "application/json", authorization: "Bearer " + this.options.runtimeToken },
        body: JSON.stringify({ jobId, leaseId, activationId: this.options.activationId }), signal: AbortSignal.timeout(1500) });
      await response.body?.cancel();
    } catch { /* Absolute native leases remain bounded if cancellation delivery fails. */ }
  }
  async cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (job) { job.controller.abort(new Error("Decision cancelled")); await this.sendCancel(jobId, job.leaseId); }
  }
  async metrics() {
    if (Date.now() - this.checkedAt >= 5000) { try { await this.probe(); } catch { this.ready = false; } }
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [DECISION_MODEL] : [] };
  }
}

async function boundedBody(response: Response, maximum: number) {
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new AdapterError("Decision runtime HTTP " + response.status, "decision_runtime_failed", response.status >= 500 || response.status === 429);
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > maximum) throw new Error("decision_response_limit"); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
