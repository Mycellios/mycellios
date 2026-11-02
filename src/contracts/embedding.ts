import { createHash } from "node:crypto";
import { z } from "zod";
import type { ChatCompletionRequest, ModelDeployment } from "./types.js";

export const EMBEDDING_MODEL = "mycellios-qwen3-embedding-4b";
export const EMBEDDING_REVISION = "5cf2132abc99cad020ac570b19d031efec650f2b";
export const EMBEDDING_DIGEST = "sha256:" + createHash("sha256").update([
  "mycellios-embedding/1", EMBEDDING_REVISION,
  "278f26db5ee6e540a5e4e0d88ebca6222530b204b9b164721670d589d151b887",
  "95b9900b4c5ff61d015447f6ba0add02ba4cfe1c1d6a3a674bc041856f34018a",
].join("\0")).digest("hex");
export const MAX_EMBEDDING_RESPONSE_BYTES = 750_000;
export const embeddingInputSchema = z.object({
  schema: z.literal("mycellios-embeddings/1"),
  input: z.array(z.string().min(1).max(32768).refine((text) => text.trim().length > 0)).min(1).max(8),
  dimensions: z.number().int().min(32).max(2560).default(2560),
}).strict();
export const embeddingWorkerAdapterSchema = z.object({
  kind: z.literal("embedding"), model: z.literal(EMBEDDING_MODEL),
  baseUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname)
      && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/";
  }, "Embedding workers require a credential-free loopback runtime"),
}).strict();
export function parseEmbeddingRequest(request: Pick<ChatCompletionRequest, "model" | "messages">) {
  if (request.model !== EMBEDDING_MODEL) throw new Error("embedding_model_mismatch");
  const users = request.messages.filter((m) => m.role === "user");
  if (users.length !== 1 || request.messages.some((m) => !["user", "system", "developer"].includes(m.role))) throw new Error("embedding_requires_one_user_envelope");
  return embeddingInputSchema.parse(JSON.parse(users[0]!.content));
}
const resultSchema = z.object({
  object: z.literal("list"), model: z.literal(EMBEDDING_MODEL),
  data: z.array(z.object({ object: z.literal("embedding"), index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()).min(32).max(2560) }).strict()).min(1).max(8),
  usage: z.object({ prompt_tokens: z.number().int().positive().max(2048), total_tokens: z.number().int().positive().max(2048) }).strict(),
}).strict();
export function verifiedEmbeddingEnvelope(content: string, request: ReturnType<typeof parseEmbeddingRequest>) {
  if (Buffer.byteLength(content) > MAX_EMBEDDING_RESPONSE_BYTES) throw new Error("embedding_response_limit");
  const envelope = z.object({ schema: z.literal("mycellios-embeddings/1"), result: resultSchema }).strict().parse(JSON.parse(content));
  const result = envelope.result;
  if (result.data.length !== request.input.length || result.usage.total_tokens !== result.usage.prompt_tokens) throw new Error("embedding_count_or_usage_mismatch");
  for (const [index, row] of result.data.entries()) {
    const norm = Math.sqrt(row.embedding.reduce((sum, x) => sum + x*x, 0));
    if (row.index !== index || row.embedding.length !== request.dimensions || Math.abs(norm - 1) > 0.002) throw new Error("embedding_vector_integrity_failure");
  }
  return envelope;
}
export function isEmbeddingDeployment(deployment: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined) {
  return deployment?.adapter === "embedding" && deployment.model === EMBEDDING_MODEL && deployment.modelDigest === EMBEDDING_DIGEST;
}
