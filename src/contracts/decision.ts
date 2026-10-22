import { createHash } from "node:crypto";
import { z } from "zod";
import type { ModelDeployment } from "./types.js";

export const DECISION_MODEL = "jev";
export const DECISION_REVISION = "9e37a4eb7def2f73a1bd1301218b063a48ad12c9";
export const DECISION_TOKENIZER_SHA256 = "06b9509352d2af50381ab2247e083b80d32d5c0aba91c272ca9ff729b6a0e523";
export const DECISION_DIGEST = "sha256:51c9353a5ff0b8e2f7cd7262359c0b26ea54b327214fe26a5da52b505b2978e8";
// Initial serving limit, deliberately below the underlying 2048-token graph.
// Increasing it requires a physical latency/memory campaign, not a schema edit.
export const DECISION_CONTEXT_LIMIT = 256;
export const DECISION_DEADLINE_MS = 540_000;
export const MAX_DECISION_RESPONSE_BYTES = 16_384;
const label = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const unicode = (text: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
const description = z.string().max(4096).refine(unicode);
const criteria = z.record(label, description).refine((v) => Object.keys(v).length >= 2 && Object.keys(v).length <= 16);
const questionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), instructions: description, criteria }).strict(),
  z.object({ type: z.literal("score"), instructions: description, criteria: z.array(description).min(2).max(16) }).strict(),
  z.object({ type: z.literal("noul"), instructions: description,
    criteria: z.object({ false: description, true: description }).strict().optional() }).strict(),
]);
// Require a string in this first public contract. This avoids differences between
// JSON object serialization in JavaScript and the pinned C++ recipe.
export const decisionInputSchema = z.object({
  schema: z.literal("mycellios-decisions/1"),
  state: z.string().min(1).max(16_384).refine(unicode),
  questions: z.record(label, questionSchema).refine((v) => Object.keys(v).length === 1),
}).strict().refine((v) => Buffer.byteLength(JSON.stringify(v)) <= 32_768);
export type DecisionInput = z.infer<typeof decisionInputSchema>;

export const decisionWorkerAdapterSchema = z.object({
  kind: z.literal("decision"), model: z.literal(DECISION_MODEL),
  baseUrl: z.string().url().refine((value) => {
    const u = new URL(value);
    return u.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(u.hostname)
      && !u.username && !u.password && !u.search && !u.hash && u.pathname === "/";
  }, "Decision workers require a credential-free loopback runtime"),
}).strict();

export function parseDecisionRequest(request: { model: string; messages: ReadonlyArray<{ role: string; content: string }> }): DecisionInput {
  if (request.model !== DECISION_MODEL || request.messages.length !== 1 || request.messages[0]?.role !== "user") {
    throw new Error("decision_requires_one_user_envelope");
  }
  return decisionInputSchema.parse(JSON.parse(request.messages[0].content));
}

export function decisionRequestDigest(input: DecisionInput): string {
  const [id, question] = Object.entries(decisionInputSchema.parse(input).questions)[0]!;
  const ordered = question.type === "choice"
    ? { ...question, criteria: Object.entries(question.criteria).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0) }
    : question.type === "noul" && question.criteria
      ? { ...question, criteria: { false: question.criteria.false, true: question.criteria.true } } : question;
  // Explicit fields keep request identity independent of caller property order.
  const body = { schema: input.schema, state: input.state,
    question: { id, type: ordered.type, instructions: ordered.instructions,
      ...(ordered.type === "noul" && !ordered.criteria ? {} : { criteria: ordered.criteria }) } };
  return "sha256:" + createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

export function decisionOptions(input: DecisionInput): string[] {
  const question = Object.values(input.questions)[0]!;
  return question.type === "choice" ? Object.keys(question.criteria).sort()
    : question.type === "score" ? question.criteria.map((_, i) => String(i)) : ["false", "true"];
}

const probability = z.object({ option: z.string(), probability: z.number().finite().min(0).max(1) }).strict();
const envelopeSchema = z.object({
  schema: z.literal("mycellios-decisions/1"), model: z.literal(DECISION_MODEL),
  underlying_model: z.literal("mys/kev-4b-GGUF"), revision: z.literal(DECISION_REVISION),
  artifact_identity: z.literal(DECISION_DIGEST), request_digest: z.string(),
  tokenizer_sha256: z.literal(DECISION_TOKENIZER_SHA256),
  result: z.object({ question_id: label, type: z.enum(["choice", "score", "noul"]),
    value: z.union([z.string(), z.number().finite()]), probabilities: z.array(probability).min(2).max(16) }).strict(),
  usage: z.object({ prompt_tokens: z.number().int().positive().max(DECISION_CONTEXT_LIMIT),
    completion_tokens: z.literal(0), total_tokens: z.number().int().positive().max(DECISION_CONTEXT_LIMIT) }).strict(),
}).strict();

export function verifiedDecisionEnvelope(content: string, input: DecisionInput) {
  if (Buffer.byteLength(content) > MAX_DECISION_RESPONSE_BYTES) throw new Error("decision_response_limit");
  const result = envelopeSchema.parse(JSON.parse(content));
  const [id, question] = Object.entries(input.questions)[0]!;
  const options = decisionOptions(input), rows = result.result.probabilities;
  if (result.request_digest !== decisionRequestDigest(input) || result.result.question_id !== id
    || result.result.type !== question.type || result.usage.prompt_tokens !== result.usage.total_tokens
    || rows.length !== options.length || rows.some((row, i) => row.option !== options[i])
    || Math.abs(rows.reduce((sum, r) => sum + r.probability, 0) - 1) > 1e-6) {
    throw new Error("decision_response_integrity_failure");
  }
  const winningIndex = rows.reduce((best, row, i) => row.probability > rows[best]!.probability ? i : best, 0);
  const expected = question.type === "choice" ? options[winningIndex]!
    : question.type === "noul" ? rows[1]!.probability
      : rows.reduce((sum, row, i) => sum + i * row.probability, 0);
  if (typeof expected === "number" ? typeof result.result.value !== "number" || Math.abs(result.result.value - expected) > 1e-6
    : result.result.value !== expected) throw new Error("decision_value_semantics_mismatch");
  return result;
}

export function isDecisionDeployment(deployment: Pick<ModelDeployment, "adapter" | "model" | "modelDigest"> | undefined) {
  return deployment?.adapter === "decision" && deployment.model === DECISION_MODEL && deployment.modelDigest === DECISION_DIGEST;
}
