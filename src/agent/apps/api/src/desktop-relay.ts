import { createHash } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import type { Hono } from "hono";
import {
  parseDesktopBinding,
  parseDesktopDispatch,
  parseDesktopPoll,
  parseDesktopResult,
} from "../../../../contracts/desktop-executor.js";
import {
  DesktopRelayBroker,
  desktopRelayKey,
  hostComputerRequest,
  verifyDesktopRelay,
} from "../../../packages/adapters/src/desktop-relay.js";
import { HOST_COMPUTER_MAX_BYTES } from "../../../packages/adapters/src/host-computer-protocol.js";
import { readBoundedBody } from "./http-body.js";

/** Fixed routes; no remote URL, path, OS token or account identity comes from the browser. */
export function mountDesktopRelay(
  app: Hono,
  deps: {
    enabled: boolean;
    secret: string;
    authenticate(request: Request): Promise<{ actor: Actor; sessionId: string } | null>;
    ownsBot(actor: Actor, botId: string): Promise<boolean>;
  },
) {
  const broker = new DesktopRelayBroker();
  const replay = new Map<string, number>();
  const secret = desktopRelayKey(deps.secret);
  app.post("/api/desktop-relay/internal", async (c) => {
    const body = await readBoundedBody(c.req.raw, HOST_COMPUTER_MAX_BYTES);
    if (body === null) return c.json({ error: "Too large" }, 413);
    if (
      !verifyDesktopRelay(
        secret,
        c.req.header("x-desktop-time") ?? "",
        body,
        c.req.header("x-desktop-signature") ?? "",
      )
    )
      return c.json({ error: "Unauthorized" }, 401);
    try {
      const input = parseDesktopDispatch(JSON.parse(body));
      for (const [nonce, expires] of replay) if (expires < Date.now()) replay.delete(nonce);
      if (replay.has(input.nonce) || replay.size >= 10_000)
        return c.json({ error: "Duplicate request" }, 409);
      replay.set(input.nonce, Date.now() + 60_000);
      if (!deps.enabled) return c.json({ error: "Unavailable" }, 404);
      if (input.probe && !input.request)
        return c.json({ available: broker.available(input.scope, input.probe) });
      if (!input.request || input.probe) return c.json({ error: "Invalid request" }, 400);
      return broker.dispatch(hostComputerRequest.parse(input.request), {
        ...input.scope,
        operationId: input.nonce,
        traceId: input.nonce,
        signal: c.req.raw.signal,
      });
    } catch {
      return c.json(
        {
          error:
            "Desktop unavailable. Reconnect this agent in Desktop; check results before retrying.",
        },
        409,
      );
    }
  });
  app.post("/api/desktop-relay/:action", async (c) => {
    c.header("cache-control", "no-store");
    if (!deps.enabled) return c.json({ error: "Unavailable" }, 404);
    // Native main is the only caller. Do not permit form/CSRF requests from web origins.
    if (c.req.header("origin") || c.req.header("x-mycellios-desktop") !== "1")
      return c.json({ error: "Native client required" }, 403);
    const session = await deps.authenticate(c.req.raw);
    if (!session) return c.json({ error: "Sign in again" }, 401);
    const owner = {
      userId: session.actor.userId,
      spaceId: session.actor.spaceId,
      sessionId: session.sessionId,
    };
    const identity = {
      userId: owner.userId,
      spaceId: owner.spaceId,
      connectionId: createHash("sha256").update(owner.sessionId).digest("hex"),
    };
    const body = await readBoundedBody(c.req.raw, 360_000);
    if (body === null) return c.json({ error: "Too large" }, 413);
    try {
      const input = JSON.parse(body);
      switch (c.req.param("action")) {
        case "identity":
          return c.json(identity);
        case "bind": {
          const value = parseDesktopBinding(input);
          if (!(await deps.ownsBot(session.actor, value.botId)))
            return c.json({ error: "Unavailable agent" }, 404);
          broker.bind(owner, value);
          return c.json({ ok: true });
        }
        case "poll": {
          const value = parseDesktopPoll(input);
          for (const botId of broker.ownedBindings(owner, value.deviceId))
            if (!(await deps.ownsBot(session.actor, botId))) broker.revokeBot(owner, botId);
          // Membership/session was freshly checked above on every heartbeat.
          return c.json({ ...broker.poll(owner, value.deviceId), identity });
        }
        case "result": {
          const value = parseDesktopResult(input);
          broker.result(owner, value.deviceId, value.id, value.seq, value.data, value.done);
          return c.json({ ok: true });
        }
        case "revoke":
          broker.revoke(owner, parseDesktopPoll(input).deviceId);
          return c.json({ ok: true });
        default:
          return c.json({ error: "Unavailable" }, 404);
      }
    } catch {
      return c.json({ error: "Desktop connection changed. Reconnect the project." }, 409);
    }
  });
  return () => broker.close();
}
