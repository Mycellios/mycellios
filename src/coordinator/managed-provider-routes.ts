import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ManagedGateway } from "./managed-gateway.js";
import type { ManagedTextRequest } from "./managed-openrouter.js";
type TextGateway=Pick<ManagedGateway,"catalog"|"quote"|"execute"|"reconcile"|"replayFor">;

/** Mounted only by an explicitly configured, migrated, account-authenticated coordinator. */
export function mountManagedProviderRoutes(app: FastifyInstance, context: {
  gateway: TextGateway;
  account(request: FastifyRequest): { userId: string; apiKeyId: string | null };
}) {
  app.get("/v1/managed/models", async request => {
    context.account(request);
    return { object: "list", data: await context.gateway.catalog() };
  });
  app.post("/v1/managed/quote", { bodyLimit: 262_144 }, async (request, reply) => {
    const account = context.account(request);
    try {
      return await context.gateway.quote(account.userId, parse(request.body));
    } catch (error) { return failure(reply, error); }
  });
  app.post("/v1/managed/execute", { bodyLimit: 262_144 }, async (request, reply) => {
    const account = context.account(request);
    try {
      const body = request.body as { request?: unknown; quoteToken?: unknown } | null;
      if (!body || Object.keys(body).some(k => !["request", "quoteToken"].includes(k)) || typeof body.quoteToken !== "string")
        throw new Error("managed_request_invalid");
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string") throw new Error("managed_idempotency_required");
      const result = await context.gateway.execute(account.userId, account.apiKeyId, key, parse(body.request), body.quoteToken);
      return reply.code(result.status === "completed" ? 200 : 202).send(result);
    } catch (error) { return failure(reply, error); }
  });
  app.post("/v1/managed/reconcile", { bodyLimit: 2048 }, async (request, reply) => {
    const account = context.account(request);
    try {
      const key = (request.body as { idempotencyKey?: unknown } | null)?.idempotencyKey;
      if (typeof key !== "string" || key.length < 8 || key.length > 200) throw new Error("managed_idempotency_required");
      const result = await context.gateway.reconcile(account.userId, key);
      return reply.code(result.status === "completed" ? 200 : 202).send(result);
    } catch (error) { return failure(reply, error); }
  });
}
/** The model id explicitly selects paid managed inference; native failures never enter this route. */
export async function handleManagedChat(request: FastifyRequest, reply: import("fastify").FastifyReply,
  gateway: TextGateway, account: { userId: string; apiKeyId: string | null }) {
  if (request.headers["x-mycellios-funding"] !== "contribution-credits")
    return reply.code(400).send({ error: { code: "managed_funding_required", message: "This Mycellios model uses Credits." } });
  let streaming = false;
  try {
    const body = parse(request.body), key = request.headers["idempotency-key"];
    if (typeof key !== "string") throw new Error("managed_idempotency_required");
    const replay = await gateway.replayFor(account.userId, key, body);
    const quote = replay ? null : await gateway.quote(account.userId, body);
    const maximum = request.headers["x-mycellios-max-credit-microunits"];
    if (quote && maximum !== undefined && (typeof maximum !== "string" || !/^\d+$/.test(maximum)
      || !Number.isSafeInteger(Number(maximum)) || quote.maximumMicrounits > Number(maximum)))
      throw new Error("managed_user_budget_exceeded");
    if (body.stream === true) {
      streaming = true; reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" });
    }
    const send = (value: unknown) => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(value)}\n\n`);
    };
    let sent = false;
    const heartbeat = streaming ? setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": mycellios-heartbeat\n\n");
    }, 10000) : null;
    heartbeat?.unref();
    let result: Awaited<ReturnType<ManagedGateway["execute"]>>;
    try {
      result = replay ?? await gateway.execute(account.userId, account.apiKeyId, key, body, quote!.token,
        streaming ? chunk => { sent = true; send(chunk); } : undefined);
    } finally { if (heartbeat) clearInterval(heartbeat); }
    if (!streaming) return reply.code(result.status === "completed" ? 200 : 202).send(result.status === "completed" ? result.response : result);
    if (result.status !== "completed") send({ error: { code: "managed_pending_reconciliation", message: "The provider result or charge is still being checked. Do not submit a new paid request.", requestId: result.requestId } });
    else {
      const choices = result.response.choices as Array<{ index: number; message: unknown; finish_reason: unknown }>;
      if (!sent) { // Durable replay delivers the same result without calling inference again.
        send({ id: result.response.id, object: "chat.completion.chunk", model: body.model,
          choices: choices.map(c => ({ index: c.index, delta: c.message, finish_reason: null })) });
      }
      send({ id: result.response.id, object: "chat.completion.chunk", created: result.response.created, model: body.model,
        choices: choices.map(c => ({ index: c.index, delta: {}, finish_reason: c.finish_reason })) });
      send({ id: result.response.id, object: "chat.completion.chunk", model: body.model,
        choices: [], usage: result.response.usage, mycellios: result.response.mycellios });
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write("data: [DONE]\n\n");
    }
    reply.raw.end();
  } catch (error) {
    if (!streaming) return failure(reply, error);
    if (!reply.raw.destroyed && !reply.raw.writableEnded) {
      reply.raw.write('data: {"error":{"code":"managed_request_failed","message":"Mycellios could not complete this request."}}\n\n'); reply.raw.end();
    }
  }
}
function parse(body: unknown): ManagedTextRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("managed_request_invalid");
  const value = body as Record<string, unknown>;
  if (typeof value.model !== "string" || !Array.isArray(value.messages)) throw new Error("managed_request_invalid");
  return value as ManagedTextRequest;
}
function failure(reply: import("fastify").FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  // Never echo provider responses, SQL errors, credentials or request content.
  const code = /^(managed_[a-z_]+|insufficient_contribution_credits)$/.test(message) ? message : "managed_request_failed";
  const status = code === "insufficient_contribution_credits" ? 402 : /conflict|price_changed|expired/.test(code) ? 409 : 400;
  return reply.code(status).send({ error: { code, message: "Mycellios could not accept this request. No new paid request was retried." } });
}
