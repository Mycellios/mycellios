import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { GuestChatConfig } from "../core/guest-chat-config.js";
import type { MeshDatabase } from "../storage/database.js";
import { GuestChat, GuestChatError, type GuestChatGateway } from "./guest-chat.js";

/** Always answers `GET config`; without configuration, owner tables or a free route it reports disabled. */
export async function initializeGuestChat(app: FastifyInstance, config: GuestChatConfig | undefined, database: MeshDatabase,
  gateway: GuestChatGateway | undefined, clientAddress: (request: FastifyRequest) => string) {
  const service = config ? new GuestChat(config, database, gateway) : undefined;
  if (service && !(await service.initialize()))
    app.log.warn({ event: "guest_chat_unavailable" }, "Guest chat is configured but its owner tables or free route are missing");
  mountGuestChat(app, service, clientAddress);
  return service;
}

export const GUEST_CHAT_BASE = "/mobile/v1/guest";
const STATUS: Record<string, number> = {
  guest_chat_unavailable: 503, guest_origin_required: 403, guest_session_required: 401, guest_session_expired: 401,
  guest_challenge_invalid: 400, guest_request_invalid: 400, guest_sessions_limit: 429, guest_session_limit_reached: 429,
  guest_prefix_daily_limit: 429, guest_daily_budget_reached: 503, guest_busy: 503, guest_request_in_progress: 409,
  guest_temporarily_unavailable: 503,
};
export function guestCookieName(publicOrigin: string) {
  return publicOrigin.startsWith("https:") ? "__Secure-mycellios-guest" : "mycellios-guest-local";
}
const errorCode = (error: unknown) => error instanceof GuestChatError && STATUS[error.message] ? error.message
  : error instanceof z.ZodError ? "guest_request_invalid" : "guest_temporarily_unavailable";

/**
 * Guest routes accept only their own path-scoped cookie and never read or set SSO cookies.
 * No CORS grant; every write needs the exact first-party Origin. Logs carry codes only.
 */
export function mountGuestChat(app: FastifyInstance, service: GuestChat | undefined,
  clientAddress: (request: FastifyRequest) => string) {
  const origin = service?.config.publicOrigin;
  const cookie = origin ? guestCookieName(origin) : "";
  const secure = Boolean(origin?.startsWith("https:"));
  const token = (request: FastifyRequest) => (request.headers.cookie ?? "").split(";").map(part => part.trim())
    .find(part => part.startsWith(cookie + "="))?.slice(cookie.length + 1);
  const handle = (run: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer")
        .header("x-content-type-options", "nosniff");
      try {
        if (!service?.available()) throw new GuestChatError("guest_chat_unavailable");
        if (request.method !== "GET" && request.headers.origin !== origin) throw new GuestChatError("guest_origin_required");
        return await run(request, reply);
      } catch (error) {
        const code = errorCode(error);
        if (code === "guest_temporarily_unavailable") request.log.warn({ event: "guest_chat_failure" }, "Guest chat request failed");
        return reply.code(STATUS[code]!).send({ error: { code } });
      }
    };

  app.get(GUEST_CHAT_BASE + "/config", async (_request, reply) => {
    reply.header("cache-control", "private, no-store").header("referrer-policy", "no-referrer");
    return service?.publicConfig() ?? { enabled: false };
  });
  app.post(GUEST_CHAT_BASE + "/session", { bodyLimit: 2048 }, handle(async (request, reply) => {
    const input = z.object({ nonce: z.string().max(128), challenge: z.string().max(512), solution: z.string().max(12) })
      .strict().parse(request.body);
    const { session, token: value } = await service!.enter(input, clientAddress(request));
    const maxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
    reply.header("set-cookie", `${cookie}=${value}; Path=${GUEST_CHAT_BASE}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`);
    return service!.status(session);
  }));
  app.get(GUEST_CHAT_BASE + "/session", handle(async request => service!.status(await service!.authenticate(token(request)))));
  app.post(GUEST_CHAT_BASE + "/chat", { bodyLimit: 81_920 }, handle(async (request, reply) => {
    if (request.headers.accept !== "text/event-stream") throw new GuestChatError("guest_request_invalid");
    const session = await service!.authenticate(token(request));
    // Refusals before the stream opens keep their HTTP status, so the visitor sees a clear reason.
    const parsed = service!.input.safeParse(request.body);
    if (!parsed.success) throw new GuestChatError("guest_request_invalid");
    let opened = false;
    const open = () => {
      if (opened) return; opened = true;
      reply.hijack();
      reply.raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "private, no-store, no-transform", "x-accel-buffering": "no", "referrer-policy": "no-referrer" });
    };
    const send = (value: unknown) => {
      open();
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write("data: " + JSON.stringify(value) + "\n\n");
    };
    const heartbeat = setInterval(() => { if (opened && !reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": guest\n\n"); }, 10_000);
    heartbeat.unref();
    try {
      const result = await service!.chat(session, parsed.data, chunk => {
        const content = (chunk as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) send({ type: "delta", content });
      });
      send({ type: "result", result });
    } catch (error) {
      if (!opened) throw error;
      send({ type: "error", code: errorCode(error) });
    } finally {
      clearInterval(heartbeat);
      if (opened) reply.raw.end();
    }
    return reply;
  }));
}
