import type { EventDemoConfig } from "../core/event-demo-config.js";
import type { MeshDatabase } from "../storage/database.js";
import type { FastifyRequest } from "fastify";

/** Temporary Agent keys never become general account, node or payment credentials. */
export async function eventAgentAccess(config: EventDemoConfig | undefined, db: MeshDatabase,
  principal: { userId: string; apiKeyId: string }, request: Pick<FastifyRequest, "url" | "method" | "body">,
  now = Date.now()) {
  if (!principal.userId.startsWith("demo:")) return true;
  const match = /^demo:([a-z0-9-]{8,64}):([a-f0-9-]{36})$/.exec(principal.userId);
  if (!match || !config || match[1] !== config.id || now < config.startsAt || now >= config.endsAt
    || principal.apiKeyId !== "demo-agent:" + match[2]) return false;
  const path = request.url.split("?")[0];
  const read = request.method === "GET" && ["/v1/models", "/v1/account/economy"].includes(path!);
  const write = request.method === "POST" && ["/v1/chat/completions", "/v1/managed/quote", "/v1/managed/execute", "/v1/managed/reconcile"].includes(path!);
  if (!read && !write) return false;
  if (write && path !== "/v1/managed/reconcile") {
    const body = request.body as { model?: unknown; request?: { model?: unknown } } | null;
    if ((path === "/v1/managed/execute" ? body?.request?.model : body?.model) !== config.model) return false;
  }
  return Boolean(await db.raw.prepare("SELECT id FROM economic_demo_guests WHERE campaign_id=? AND id=? AND account_id=?")
    .get(config.id, match[2]!, principal.userId));
}
