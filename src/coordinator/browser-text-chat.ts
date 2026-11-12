import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { BrowserInference } from "./browser-inference.js";

const input = z.object({ model: z.string(), messages: z.array(z.object({
  role: z.enum(["system", "user", "assistant"]), content: z.string().min(1).max(2048),
}).strict()).min(1).max(12), max_tokens: z.number().int().min(1).max(32).default(32),
  temperature: z.literal(0).optional(), stream: z.boolean().optional(),
}).strict();
/** Explicit account-funded path. Stream only a fully checked, settled response. No supplier fallback. */
export async function browserTextChat(request: FastifyRequest, reply: FastifyReply,
  service: BrowserInference, accountId: string, apiKeyId: string | null) {
  if (request.headers["x-mycellios-funding"] !== "contribution-credits") throw new Error("browser_funding_required");
  const body = input.parse(request.body);
  const key = z.string().min(8).max(200).parse(request.headers["idempotency-key"]);
  const prompt = body.messages.length === 1 && body.messages[0]!.role === "user" ? body.messages[0]!.content
    : body.messages.map(m => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
  const work = { kind: "text" as const, model: body.model, prompt, maxTokens: body.max_tokens };
  // Recovery is read-only even after a restart/offer closure; never request a new quote for a replay.
  const prior = await service.replayRequest(accountId, key, work);
  const quote = prior ? null : service.quote(accountId, work);
  const maximum = request.headers["x-mycellios-max-credit-microunits"];
  if (quote && maximum !== undefined && (typeof maximum !== "string" || !/^\d+$/.test(maximum)
    || !Number.isSafeInteger(Number(maximum)) || quote.creditsMicrounits > Number(maximum))) throw new Error("browser_user_budget_exceeded");
  const result = prior ?? await service.execute(accountId, apiKeyId, key, work, quote!.token);
  if (result.status !== "completed") return reply.code(result.status === "failed" ? 503 : 202).send(result);
  const response = result.response as { id: string; created: number; model: string; choices: Array<{ index: number; message: unknown; finish_reason: string }>; usage: unknown };
  if (!body.stream) return reply.send(response);
  return reply.type("text/event-stream").header("cache-control", "no-cache, no-transform").send(
    `data: ${JSON.stringify({ id: response.id, object: "chat.completion.chunk", created: response.created, model: response.model,
      choices: response.choices.map(c => ({ index: c.index, delta: c.message, finish_reason: null })) })}\n\n`
    + `data: ${JSON.stringify({ id: response.id, object: "chat.completion.chunk", model: response.model,
      choices: response.choices.map(c => ({ index: c.index, delta: {}, finish_reason: c.finish_reason })), usage: response.usage })}\n\n`
    + "data: [DONE]\n\n");
}
