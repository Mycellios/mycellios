import { z } from "zod";
import type { ChatCompletionRequest } from "../contracts/types.js";
import type { SpeechCatalogEntry } from "../contracts/speech-catalog.js";
import { kokoroWorkerAdapterSchema, resolveSpeechOptions, verifiedSpeechEnvelope } from "../contracts/speech.js";
import { parseTranscriptionRequest, transcriptionWorkerAdapterSchema, verifiedTranscriptionEnvelope } from "../contracts/transcription.js";
import { AdapterError, type AdapterCapabilities, type AdapterChunk, type AdapterRequest, type InferenceAdapter } from "./base.js";

/** A task-specific request body plus the check its result must pass. */
interface PreparedSpeechTask {
  readonly body: unknown;
  verify(content: string, inputTokens: number): void;
}

function prepareTranscription(entry: SpeechCatalogEntry, request: ChatCompletionRequest): PreparedSpeechTask {
  const input = parseTranscriptionRequest(request);
  return {
    body: input,
    verify(content, inputTokens) {
      const envelope = verifiedTranscriptionEnvelope(content, input);
      if (inputTokens !== envelope.usage.input_tokens) throw new Error(`${entry.errorPrefix}_usage_mismatch`);
    },
  };
}

function prepareSynthesis(entry: SpeechCatalogEntry, request: ChatCompletionRequest): PreparedSpeechTask {
  const users = request.messages.filter((message) => message.role === "user");
  if (users.length !== 1 || request.messages.some((m) => !["user", "system", "developer"].includes(m.role))) {
    throw new AdapterError("Speech requires one user text, without conversation history", "invalid_speech_request", false);
  }
  const text = users[0]!.content;
  const options = resolveSpeechOptions(request);
  if (!text.trim() || [...text].length > 400) throw new Error(`${entry.errorPrefix}_text_limit_exceeded`);
  return { body: { text, ...options }, verify(content) { verifiedSpeechEnvelope(content, text, options); } };
}

const TASKS = { transcribe: prepareTranscription, synthesize: prepareSynthesis } as const;
const LOOPBACK_SCHEMAS = { transcription: transcriptionWorkerAdapterSchema, kokoro: kokoroWorkerAdapterSchema } as const;

/**
 * One adapter for every speech model in the catalog (specs/speech-replica):
 * health checks pin the runtime and artifact identity, requests go to the
 * task's loopback endpoint, and results are verified against the request
 * before any chunk is emitted. The worker owns admission and leases; the
 * loopback runtime owns model loading.
 */
export class SpeechReplicaAdapter implements InferenceAdapter {
  readonly kind: SpeechCatalogEntry["adapterKind"];
  private readonly baseUrl: URL;
  private ready = false;
  private checkedAt = 0;
  private inFlightProbe: Promise<AdapterCapabilities> | null = null;
  private readonly jobs = new Map<string, AbortController>();

  constructor(private readonly entry: SpeechCatalogEntry, options: { baseUrl: string; model: string; modelDigest: string }) {
    this.kind = entry.adapterKind;
    const config = LOOPBACK_SCHEMAS[entry.adapterKind].parse({ kind: entry.adapterKind, model: options.model, baseUrl: options.baseUrl });
    if (options.modelDigest !== entry.digest) throw new Error(`${entry.errorPrefix}_model_digest_mismatch`);
    this.baseUrl = new URL(config.baseUrl);
  }

  probe(): Promise<AdapterCapabilities> {
    this.inFlightProbe ??= this.probeOnce().finally(() => { this.inFlightProbe = null; });
    return this.inFlightProbe;
  }

  private async probeOnce(): Promise<AdapterCapabilities> {
    this.ready = false;
    this.checkedAt = Date.now();
    const response = await fetch(new URL("health", this.baseUrl), { signal: AbortSignal.timeout(5_000), redirect: "error" });
    const health = z.object({
      status: z.literal("ready"), model: z.literal(this.entry.model),
      artifact_identity: z.literal(this.entry.digest),
      runtime: z.literal(this.entry.runtime), tokenizer: z.literal("cl100k_base"),
    }).parse(JSON.parse(await this.boundedBody(response, 4096)));
    this.ready = health.status === "ready";
    return { kind: this.kind, models: [this.entry.model], streaming: true, embeddings: false, reranking: false };
  }

  async warm(model: string): Promise<void> {
    if (model !== this.entry.model) throw new Error(`${this.entry.errorPrefix}_model_mismatch`);
    await this.probe();
  }

  async *generate(input: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
    const prefix = this.entry.errorPrefix;
    if (input.request.model !== this.entry.model) throw new Error(`${prefix}_not_ready_or_model_mismatch`);
    signal.throwIfAborted();
    try { await this.probe(); } catch { throw new Error(`${prefix}_not_ready_or_model_mismatch`); }
    signal.throwIfAborted();
    if (input.lease && input.lease.deadline <= Date.now()) throw new Error(`${prefix}_worker_lease_expired`);
    const task = TASKS[this.entry.task](this.entry, input.request);
    const controller = new AbortController();
    this.jobs.set(input.jobId, controller);
    try {
      const response = await fetch(new URL(this.entry.endpoint, this.baseUrl), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(task.body), redirect: "error",
        signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(120_000)]),
      });
      const result = z.object({
        model: z.literal(this.entry.model),
        content: z.string().min(1).max(this.entry.maxResponseBytes),
        input_tokens: z.number().int().positive().max(10_000),
        tokenizer: z.literal("cl100k_base"),
      }).parse(JSON.parse(await this.boundedBody(response, this.entry.maxResponseBytes)));
      task.verify(result.content, result.input_tokens);
      for (let offset = 0, index = 0; offset < result.content.length; offset += 16_384, index++) {
        if (signal.aborted) throw signal.reason;
        yield { index, text: result.content.slice(offset, offset + 16_384),
          metrics: { inputTokens: result.input_tokens, outputTokens: 0 } };
      }
    } finally {
      this.jobs.delete(input.jobId);
    }
  }

  async cancel(jobId: string): Promise<void> { this.jobs.get(jobId)?.abort(new Error("Speech cancelled")); }

  async metrics() {
    if (Date.now() - this.checkedAt >= 5000) { try { await this.probe(); } catch { this.ready = false; } }
    return { ready: this.ready, activeJobs: this.jobs.size, loadedModels: this.ready ? [this.entry.model] : [] };
  }

  private async boundedBody(response: Response, maximum: number): Promise<string> {
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new AdapterError(`${this.entry.runtimeLabel} runtime returned HTTP ${response.status}`,
        `${this.entry.errorPrefix}_runtime_failed`, response.status >= 500 || response.status === 429);
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new Error(`${this.entry.errorPrefix}_response_too_large`);
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks).toString("utf8");
  }
}
