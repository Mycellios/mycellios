import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatCompletionRequest, ModelDeployment } from "./types.js";

/**
 * Operator memory embeddings (Jarvis) served as a native replica.
 * Contract: specs/memory-embedding-qwen06/spec.md ("Native replica").
 * Vectors stay interchangeable with the private replicas: same pinned
 * artifact, 1024 dimensions, L2-normalized, query instruction applied by the
 * runtime, and only the device/precision pairs measured against CPU fp32.
 */
export const MEMORY_EMBEDDING_MODEL = "mycellios-qwen3-embedding-0.6b";
export const MEMORY_EMBEDDING_UPSTREAM_MODEL = "Qwen/Qwen3-Embedding-0.6B";
export const MEMORY_EMBEDDING_REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3";
export const MEMORY_EMBEDDING_RUNTIME = "mycellios-memory-embedding/1";
export const MEMORY_EMBEDDING_SCHEMA = "mycellios-memory-embeddings/1";
export const MEMORY_EMBEDDING_DIMENSIONS = 1024;
export const MEMORY_EMBEDDING_MAX_INPUTS = 64;
export const MEMORY_EMBEDDING_MAX_INPUT_TOKENS = 8192;
/** 64 × 1024 JSON doubles (at most 24 bytes each) plus the envelope; below the worker's 2 MiB output cap. */
export const MAX_MEMORY_EMBEDDING_RESPONSE_BYTES = 1_900_000;
/** Files transformers reads at the pinned revision (sha256 of the bytes on disk). */
export const MEMORY_EMBEDDING_FILES: Readonly<Record<string, string>> = Object.freeze({
  "config.json": "b5bf1f51fc45be473a54718cef92448d90a1be001bf9b9a44b8c7f10a19feaa9",
  "generation_config.json": "28396d421a2108acce96383f6a7de78008f7f1b17f807958f3c14c51dbfb65fb",
  "merges.txt": "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5",
  "model.safetensors": "0437e45c94563b09e13cb7a64478fc406947a93cb34a7e05870fc8dcd48e23fd",
  "tokenizer.json": "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a",
  "tokenizer_config.json": "253153d0738ceb4c668d2eff957714dd2bea0b56de772a9fdccd96cbf517e6a0",
  "vocab.json": "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910",
});
/** Exact byte sizes of the pinned files (Hugging Face tree at the pinned revision); a download must match both size and sha256. */
export const MEMORY_EMBEDDING_FILE_BYTES: Readonly<Record<string, number>> = Object.freeze({
  "config.json": 727,
  "generation_config.json": 117,
  "merges.txt": 1_671_853,
  "model.safetensors": 1_191_586_416,
  "tokenizer.json": 11_423_705,
  "tokenizer_config.json": 9_706,
  "vocab.json": 2_776_833,
});
/** Pinned source of the files above; nodes fetch only `<base>/<file>` at this exact revision. */
export const MEMORY_EMBEDDING_SOURCE_BASE_URL = `https://huggingface.co/${MEMORY_EMBEDDING_UPSTREAM_MODEL}/resolve/${MEMORY_EMBEDDING_REVISION}`;
/** Same construction as `artifact_identity()` in qwen06_embedding_service.py. */
export const MEMORY_EMBEDDING_DIGEST = "sha256:" + createHash("sha256").update([
  "mycellios-memory-embedding/1", MEMORY_EMBEDDING_REVISION,
  ...Object.keys(MEMORY_EMBEDDING_FILES).sort().map((name) => `${name}:${MEMORY_EMBEDDING_FILES[name]}`),
].join("\0")).digest("hex");

/**
 * Device/precision pairs whose vectors matched CPU fp32 (minimum cosine
 * 0.999996; CPU fp32 is the reference itself). DirectML float16 drifted to
 * 0.987 and is not admitted. Each pair runs as one non-fallback stage, and
 * every replica still has to pass the same canary cosine gate to qualify.
 * `priorTokensPerSecond` is the speed measured on 2026-11-21/22 for that kind
 * of device (for CPU, the slowest one). The coordinator sizes a replica's
 * first piece with it and then uses the speed it measures itself.
 */
export const MEMORY_EMBEDDING_EXECUTIONS: ReadonlyArray<{ backend: string; precision: string; priorTokensPerSecond: number }> = Object.freeze([
  { backend: "cuda", precision: "float16", priorTokensPerSecond: 380 },
  { backend: "mps", precision: "float16", priorTokensPerSecond: 380 },
  { backend: "directml", precision: "float32", priorTokensPerSecond: 114 },
  { backend: "cpu", precision: "float32", priorTokensPerSecond: 7 },
]);

type Execution = ModelDeployment["execution"];
/** One non-fallback stage whose backend/precision is an approved pair, on the matching device type. */
export function approvedMemoryEmbeddingExecution(execution: Execution): { backend: string; precision: string } | null {
  if (!execution || execution.fallback || execution.stages?.length !== 1) return null;
  const stage = execution.stages[0]!;
  const deviceType = stage.backend === "cpu" ? "cpu" : "gpu";
  if (stage.fallback || stage.backend !== execution.backend || stage.precision !== execution.precision
    || execution.deviceType !== deviceType || stage.deviceType !== deviceType) return null;
  const pair = MEMORY_EMBEDDING_EXECUTIONS.find((candidate) => candidate.backend === stage.backend && candidate.precision === stage.precision);
  return pair ? { backend: pair.backend, precision: pair.precision } : null;
}

/**
 * Android phone candidate (spec: "Phone replicas"). ONNX Runtime cannot read
 * the safetensors pins above, so a phone downloads this ONNX export of the
 * same model instead, checked by size and sha256. Its tokenizer is byte-equal
 * to the pinned one. On ONNX Runtime CPU (x86) the float16 export reached a
 * canary cosine of 0.9999988, while the int8 (0.905) and q4 (0.943) exports
 * failed, so only this export is pinned. No phone device/precision pair has
 * been measured on a physical phone, so none is admitted and the Android
 * host never advertises the model; `MemoryEmbeddingPins.java` mirrors these
 * values and `tests/memory-embedding-phone.test.ts` checks the mirror.
 */
export const MEMORY_EMBEDDING_PHONE_RUNTIME = "mycellios-memory-embedding-phone/1";
export const MEMORY_EMBEDDING_PHONE_SOURCE = Object.freeze({
  repository: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
  revision: "c25a394dd583836952667c12f008335071b3f43d",
});
export const MEMORY_EMBEDDING_PHONE_FILES: Readonly<Record<string, { bytes: number; sha256: string }>> = Object.freeze({
  "onnx/model_fp16.onnx": { bytes: 583_522, sha256: "f376cf065d912675dd559270e19361367ebc28c938b9811dd61d5834c78d0834" },
  "onnx/model_fp16.onnx_data": { bytes: 1_199_927_296, sha256: "06fbfded30166e3a33fe5252d7002ed1c370a4ec1bf45aba778cdf6cf7d31439" },
  "tokenizer.json": { bytes: 11_423_705, sha256: "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a" },
});
export const MEMORY_EMBEDDING_PHONE_DIGEST = "sha256:" + createHash("sha256").update([
  MEMORY_EMBEDDING_PHONE_RUNTIME, MEMORY_EMBEDDING_PHONE_SOURCE.revision,
  ...Object.keys(MEMORY_EMBEDDING_PHONE_FILES).sort().map((name) => `${name}:${MEMORY_EMBEDDING_PHONE_FILES[name]!.sha256}`),
].join("\0")).digest("hex");
/** Phone backend/precision pairs measured on a physical phone at cosine ≥ the canary gate. None yet. */
export const MEMORY_EMBEDDING_PHONE_EXECUTIONS: ReadonlyArray<{ backend: string; precision: string }> = Object.freeze([]);

/** Starting speed of an approved execution, before the coordinator has measured the replica. */
export function memoryEmbeddingPriorTokensPerSecond(execution: Execution): number | null {
  const approved = approvedMemoryEmbeddingExecution(execution);
  return MEMORY_EMBEDDING_EXECUTIONS.find((pair) => pair.backend === approved?.backend
    && pair.precision === approved.precision)?.priorTokensPerSecond ?? null;
}

/**
 * Coordinator-side size of one text, without the tokenizer: about four
 * characters per token plus the end token, capped at the runtime's
 * truncation. Piece sizing and measured throughput both use this estimate,
 * so a systematic tokenizer difference cancels out.
 */
export function estimatedMemoryEmbeddingTokens(text: string): number {
  return Math.min(MEMORY_EMBEDDING_MAX_INPUT_TOKENS, Math.ceil(text.length / 4) + 1);
}
/** Fixed cost of one piece (offer, lease, transport), counted apart from the replica's speed. */
export const MEMORY_EMBEDDING_PIECE_OVERHEAD_MS = 750;

export const memoryEmbeddingInputSchema = z.object({
  schema: z.literal(MEMORY_EMBEDDING_SCHEMA),
  input: z.array(z.string().min(1).max(32_768).refine((text) => text.trim().length > 0))
    .min(1).max(MEMORY_EMBEDDING_MAX_INPUTS),
  input_type: z.enum(["document", "query"]).default("document"),
}).strict();
export type MemoryEmbeddingInput = z.infer<typeof memoryEmbeddingInputSchema>;

export function parseMemoryEmbeddingRequest(request: Pick<ChatCompletionRequest, "model" | "messages">): MemoryEmbeddingInput {
  if (request.model !== MEMORY_EMBEDDING_MODEL) throw new Error("memory_embedding_model_mismatch");
  const users = request.messages.filter((m) => m.role === "user");
  if (users.length !== 1 || request.messages.some((m) => !["user", "system", "developer"].includes(m.role))) throw new Error("memory_embedding_requires_one_user_envelope");
  return memoryEmbeddingInputSchema.parse(JSON.parse(users[0]!.content));
}

const MAX_USAGE_TOKENS = MEMORY_EMBEDDING_MAX_INPUTS * MEMORY_EMBEDDING_MAX_INPUT_TOKENS;
const resultSchema = z.object({
  object: z.literal("list"), model: z.literal(MEMORY_EMBEDDING_MODEL), revision: z.literal(MEMORY_EMBEDDING_REVISION),
  data: z.array(z.object({ object: z.literal("embedding"), index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(MEMORY_EMBEDDING_DIMENSIONS) }).strict())
    .min(1).max(MEMORY_EMBEDDING_MAX_INPUTS),
  usage: z.object({ prompt_tokens: z.number().int().positive().max(MAX_USAGE_TOKENS), total_tokens: z.number().int().positive().max(MAX_USAGE_TOKENS) }).strict(),
}).strict();
const envelopeSchema = z.object({ schema: z.literal(MEMORY_EMBEDDING_SCHEMA), result: resultSchema }).strict();
export type MemoryEmbeddingEnvelope = z.infer<typeof envelopeSchema>;

/** Rejects any batch whose count, order, dimensions or unit length is wrong. */
export function verifiedMemoryEmbeddingEnvelope(content: string, request: MemoryEmbeddingInput): MemoryEmbeddingEnvelope {
  if (Buffer.byteLength(content) > MAX_MEMORY_EMBEDDING_RESPONSE_BYTES) throw new Error("memory_embedding_response_limit");
  const envelope = envelopeSchema.parse(JSON.parse(content));
  const result = envelope.result;
  if (result.data.length !== request.input.length || result.usage.total_tokens !== result.usage.prompt_tokens
    || result.usage.prompt_tokens < request.input.length) throw new Error("memory_embedding_count_or_usage_mismatch");
  for (const [index, row] of result.data.entries()) {
    const norm = Math.sqrt(row.embedding.reduce((sum, x) => sum + x * x, 0));
    if (row.index !== index || Math.abs(norm - 1) > 0.002) throw new Error("memory_embedding_vector_integrity_failure");
  }
  return envelope;
}

export function isMemoryEmbeddingDeployment(deployment: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined): boolean {
  return deployment?.adapter === "embedding" && deployment.model === MEMORY_EMBEDDING_MODEL && deployment.modelDigest === MEMORY_EMBEDDING_DIGEST;
}

/**
 * Qualification canary: the query below, embedded on CPU fp32 at the pinned
 * revision with Qwen's query instruction (little-endian float32, base64). A
 * replica must reach `MEMORY_EMBEDDING_CANARY_MIN_COSINE` against it, which
 * admits the measured fp16/fp32 replicas (≥ 0.999996) and rejects drift such
 * as DirectML float16 (0.987) or a missing query instruction.
 */
export const MEMORY_EMBEDDING_CANARY_QUERY = "What is the capital of Spain?";
export const MEMORY_EMBEDDING_CANARY_MIN_COSINE = 0.9995;
const CANARY_REFERENCE_BASE64 =
  "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";
let canaryReference: Float32Array | null = null;
export function memoryEmbeddingCanaryReference(): Float32Array {
  if (!canaryReference) {
    const bytes = Buffer.from(CANARY_REFERENCE_BASE64, "base64");
    if (bytes.byteLength !== MEMORY_EMBEDDING_DIMENSIONS * 4) throw new Error("memory_embedding_canary_reference_invalid");
    canaryReference = new Float32Array(MEMORY_EMBEDDING_DIMENSIONS);
    for (let i = 0; i < MEMORY_EMBEDDING_DIMENSIONS; i++) canaryReference[i] = bytes.readFloatLE(i * 4);
  }
  return canaryReference;
}
export function memoryEmbeddingCanaryCosine(vector: readonly number[]): number {
  const reference = memoryEmbeddingCanaryReference();
  if (vector.length !== reference.length) return 0;
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < reference.length; i++) {
    dot += vector[i]! * reference[i]!; left += vector[i]! * vector[i]!; right += reference[i]! * reference[i]!;
  }
  return left > 0 && right > 0 ? dot / Math.sqrt(left * right) : 0;
}
