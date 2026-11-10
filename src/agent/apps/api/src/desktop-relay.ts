import { createHash } from "node:crypto";
import type { Actor } from "@rakazo/contracts";
import { getLogger } from "@rakazo/logging";
import type { Hono } from "hono";
import {
  parseDesktopBinding,
  parseDesktopAccount,
  parseDesktopDispatch,
  parseDesktopPoll,
  parseDesktopResult,
} from "../../../../contracts/desktop-executor.js";
import {
  DesktopRelayBroker,
  DesktopRelayError,
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
    ownsBot(actor: Pick<Actor,"userId"|"spaceId">, botId: string): Promise<boolean>;
    spaces?(actor: Actor): Promise<string[]>;
    desktopExecution?(actor: Pick<Actor, "userId" | "spaceId">, enabled?: boolean): Promise<boolean>;
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
      const botId=input.probe ?? (input.request ? hostComputerRequest.parse(input.request).botId : undefined);
      if (botId) {
        if (!await deps.ownsBot(input.scope,botId)) return c.json({available:false,error:"Unavailable agent"},404);
        broker.connectAccountBot(input.scope,botId);
      }
      if (input.probe && !input.request) {
        if (input.agentExecution === 1) return c.json({ agentExecution: 1, available: broker.agentAvailable(input.scope, input.probe), preferred: await deps.desktopExecution?.(input.scope) ?? false });
        return c.json({ available: broker.available(input.scope, input.probe) });
      }
      if (!input.request || input.probe) return c.json({ error: "Invalid request" }, 400);
      return broker.dispatch(hostComputerRequest.parse(input.request), {
        ...input.scope,
        operationId: input.nonce,
        traceId: input.nonce,
        signal: c.req.raw.signal,
      });
    } catch (error) {
      if (error instanceof DesktopRelayError) {
        c.header("x-mycellios-desktop-error", error.code);
        return c.json({ error: error.message, code: error.code }, error.status);
      }
      return c.json(
        {
          error:
            "The PC bridge could not accept this request. Check results before retrying.",
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
    const action = c.req.param("action");
    let resultId: string | undefined;
    try {
      const input = JSON.parse(body);
      const poll = (value: {deviceId:string;wait?:boolean;active?:string[]}) =>
        broker.waitPoll(owner, value.deviceId, c.req.raw.signal, value.wait, value.active, value.wait ? async () => {
          const current = await deps.authenticate(c.req.raw);
          if (!current || current.sessionId !== owner.sessionId || current.actor.userId !== owner.userId || current.actor.spaceId !== owner.spaceId) {
            broker.revoke(owner,value.deviceId); throw Error("Desktop session changed while waiting");
          }
          const verifiedBots = new Set<string>();
          for (const botId of broker.ownedBindings(owner, value.deviceId)) {
            if (await deps.ownsBot(current.actor, botId)) verifiedBots.add(botId);
            else broker.revokeBot(owner, botId);
          }
          return verifiedBots;
        } : undefined);
      switch (action) {
        case "identity":
          return c.json(identity);
        case "spaces":
          return c.json({spaces:deps.spaces ? await deps.spaces(session.actor) : [owner.spaceId]});
        case "account": {
          const value=parseDesktopAccount(input);
          if(value.identity.userId!==identity.userId||value.identity.spaceId!==identity.spaceId||value.identity.connectionId!==identity.connectionId)
            return c.json({error:"The account session changed"},403);
          if (value.agentExecution === 1 && broker.needsExecutionPreference(owner, value)) await deps.desktopExecution?.(session.actor, true);
          broker.register(owner,value);
          for(const botId of broker.ownedBindings(owner,value.deviceId))
            if(!await deps.ownsBot(session.actor,botId))broker.revokeBot(owner,botId);
          return c.json({...await poll(value),identity});
        }
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
          return c.json({ ...await poll(value), identity });
        }
        case "result": {
          const value = parseDesktopResult(input);
          resultId = value.id;
          broker.result(owner, value.deviceId, value.id, value.seq, value.data, value.done);
          return c.json({ ok: true });
        }
        case "revoke":
          broker.revoke(owner, parseDesktopPoll(input).deviceId);
          if (!broker.hasAgentDevice(owner)) await deps.desktopExecution?.(session.actor, false);
          return c.json({ ok: true });
        default:
          return c.json({ error: "Unavailable" }, 404);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const reason = message === "Desktop poll is already pending" ? "poll_already_pending"
        : message === "Desktop device is not connected" ? "device_not_connected"
        : message === "Desktop session changed while waiting" ? "session_changed"
        : message === "Operation unavailable" ? "operation_unavailable"
        : message === "Invalid Desktop result" ? "invalid_result"
        : message === "Slow consumer" ? "slow_consumer" : "request_rejected";
      if (!c.req.raw.signal.aborted && (action === "account" || action === "poll" || resultId)) {
        getLogger().warn("desktop.relay.request_rejected", {
          "desktop.action": action, "desktop.operation.id": resultId, "desktop.reason": reason,
        });
      }
      if (reason === "session_changed") return c.json({error:"Sign in again"},403);
      return c.json({ error: "PC connection changed. Reconnect the paired computer." }, 409);
    }
  });
  return Object.assign(() => broker.close(), {
    /** A connected desktop host that advertises agent execution for this scope. */
    hasAgentDevice: (scope: { userId: string; spaceId: string }) => broker.hasAgentDevice(scope),
  });
}
