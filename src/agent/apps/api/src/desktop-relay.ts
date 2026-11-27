import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "@mycellios/contracts";
import { getLogger } from "@mycellios/logging";
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
  desktopDeviceKey,
  desktopRelayKey,
  hostComputerRequest,
  verifyDesktopRelay,
} from "../../../packages/adapters/src/desktop-relay.js";
import { HOST_COMPUTER_MAX_BYTES } from "../../../packages/adapters/src/host-computer-protocol.js";
import { readBoundedBody } from "./http-body.js";

/** How often an open agent channel rechecks the PC's session and its Micos. */
const DESKTOP_CHANNEL_RECHECK_MS = 60_000;

/** Fixed routes; no remote URL, path, OS token or account identity comes from the browser. */
export function mountDesktopRelay(
  app: Hono,
  deps: {
    enabled: boolean;
    secret: string;
    authenticate(request: Request): Promise<{ actor: Actor; sessionId: string } | null>;
    ownsBot(actor: Pick<Actor,"userId"|"spaceId">, botId: string): Promise<boolean>;
    /**
     * The same check for every Mico bound to a PC, in one database round trip. Each
     * poll and delivery rechecks all of them; one query per Mico made every message
     * to a PC with many Micos wait for dozens of transactions.
     */
    ownedBots?(actor: Pick<Actor,"userId"|"spaceId">, botIds: readonly string[]): Promise<ReadonlySet<string>>;
    spaces?(actor: Actor): Promise<string[]>;
    desktopExecution?(actor: Pick<Actor, "userId" | "spaceId">, enabled?: boolean): Promise<boolean>;
    /**
     * The PC (a desktopDeviceKey) the owner last chose for a Mico. It survives API
     * and Desktop restarts, which forget the volatile binding, so routines and other
     * unattended turns still reach that PC while several PCs are online.
     */
    chosenDevice?: {
      get(scope: Pick<Actor, "userId" | "spaceId">, botId: string): Promise<string | undefined>;
      remember(scope: Pick<Actor, "userId" | "spaceId">, botId: string, deviceKey: string): Promise<void>;
    };
    /** The deployed revision, reported with the handoff state. */
    revision?: string;
  },
) {
  const broker = new DesktopRelayBroker();
  /** This process's relay: a handoff's evidence names the instance it came from. */
  const instance = randomUUID();
  const replay = new Map<string, number>();
  const ownedOf = async (actor: Pick<Actor, "userId" | "spaceId">, botIds: readonly string[]): Promise<ReadonlySet<string>> => {
    if (!botIds.length) return new Set();
    if (deps.ownedBots) return deps.ownedBots(actor, botIds);
    const owned = new Set<string>();
    for (const botId of botIds) if (await deps.ownsBot(actor, botId)) owned.add(botId);
    return owned;
  };
  /** Drops this PC's bindings to Micos the account no longer owns; returns the ones it does. */
  const recheckBindings = async (actor: Pick<Actor, "userId" | "spaceId">, owner: Parameters<typeof broker.revokeBot>[0], deviceId: string) => {
    const bound = broker.ownedBindings(owner, deviceId);
    const owned = await ownedOf(actor, bound);
    for (const botId of bound) if (!owned.has(botId)) broker.revokeBot(owner, botId);
    return new Set(bound.filter(botId => owned.has(botId)));
  };
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
      // Handing its PCs to a new server version: the turn waits instead of reading the PC as
      // offline and moving to the server.
      if (input.probe && !input.request && broker.handingOff()) {
        c.header("x-mycellios-desktop-error", "desktop_updating");
        return c.json({ error: "The server is moving to a new version.", code: "desktop_updating" }, 503);
      }
      const botId=input.probe ?? (input.request ? hostComputerRequest.parse(input.request).botId : undefined);
      if (botId) {
        if (!await deps.ownsBot(input.scope,botId)) return c.json({available:false,error:"Unavailable agent"},404);
        // Only a remembered choice may settle several online PCs; one PC needs no lookup.
        const chosen = broker.needsChoice(input.scope, botId)
          ? await deps.chosenDevice?.get(input.scope, botId).catch((error: unknown) => {
            getLogger().warn("desktop.relay.choice_unavailable", { error: error instanceof Error ? error.name : "unknown" });
            return undefined;
          })
          : undefined;
        broker.connectAccountBot(input.scope,botId,chosen);
      }
      if (input.probe && !input.request) {
        // A PC is online but none could take this Mico: never report that as an offline PC.
        const unresolved = broker.unresolved(input.scope, input.probe) ? { unresolved: true } : {};
        if (input.agentExecution === 1) return c.json({ agentExecution: 1, available: broker.agentAvailable(input.scope, input.probe), preferred: await deps.desktopExecution?.(input.scope) ?? false, ...unresolved });
        return c.json({ available: broker.available(input.scope, input.probe), ...unresolved });
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
  /**
   * A deploy hands the PC connections from this API to a new version: `start` stops new work
   * reaching PCs through this instance (renew it before DESKTOP_RELAY_HANDOFF_MS ends),
   * `cancel` ends it (a rollback), `status` only reads. Every answer is the evidence the
   * deployment waits for: this instance, its revision and what is still open here. Never
   * through the public edge, and signed with the relay key like /internal.
   */
  app.post("/internal/desktop-relay/handoff", async (c) => {
    c.header("cache-control", "no-store");
    if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return c.notFound();
    const body = await readBoundedBody(c.req.raw, 1_024);
    if (body === null) return c.json({ error: "Too large" }, 413);
    if (!verifyDesktopRelay(secret, c.req.header("x-desktop-time") ?? "", body, c.req.header("x-desktop-signature") ?? ""))
      return c.json({ error: "Unauthorized" }, 401);
    let action: unknown;
    try {
      action = (JSON.parse(body) as { action?: unknown } | null)?.action;
    } catch {
      action = undefined;
    }
    if (action !== "status" && action !== "start" && action !== "cancel")
      return c.json({ error: "Invalid request" }, 400);
    if (action !== "status") {
      broker.handOff(action === "start");
      getLogger().info("desktop.relay.handoff", { "desktop.handoff": action, ...broker.handoffState() });
    }
    return c.json({ instance, ...(deps.revision ? { revision: deps.revision } : {}), ...broker.handoffState() });
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
          return recheckBindings(current.actor, owner, value.deviceId);
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
          await recheckBindings(session.actor, owner, value.deviceId);
          // ownership: this server accepts the PC's Mico folder keys in later registrations.
          // agentChannel: this server carries agent messages on an agent channel (phase 3).
          return c.json({...await poll(value),identity,ownership:1,agentChannel:1});
        }
        case "bind": {
          const value = parseDesktopBinding(input);
          if (!(await deps.ownsBot(session.actor, value.botId)))
            return c.json({ error: "Unavailable agent" }, 404);
          // Sending from, opening or connecting a Mico on this PC is the owner's choice.
          if (broker.bind(owner, value))
            await deps.chosenDevice?.remember(owner, value.botId, desktopDeviceKey(value.deviceId)).catch((error: unknown) => {
              getLogger().warn("desktop.relay.choice_not_saved", { error: error instanceof Error ? error.name : "unknown" });
            });
          return c.json({ ok: true });
        }
        case "poll": {
          const value = parseDesktopPoll(input);
          await recheckBindings(session.actor, owner, value.deviceId);
          // Membership/session was freshly checked above on every heartbeat.
          return c.json({ ...await poll(value), identity, agentChannel: 1 });
        }
        case "channel": {
          const value = parseDesktopPoll(input);
          await recheckBindings(session.actor, owner, value.deviceId);
          const closed = new AbortController();
          const stream = broker.attachChannel(owner, value.deviceId, AbortSignal.any([c.req.raw.signal, closed.signal]));
          // Checked when it opens and every minute while it stays open, instead of twice per message.
          const recheck = setInterval(() => void (async () => {
            const current = await deps.authenticate(c.req.raw);
            if (!current || current.sessionId !== owner.sessionId || current.actor.userId !== owner.userId || current.actor.spaceId !== owner.spaceId) {
              broker.revoke(owner, value.deviceId);
              return;
            }
            await recheckBindings(current.actor, owner, value.deviceId);
          })().catch(() => closed.abort()), DESKTOP_CHANNEL_RECHECK_MS);
          recheck.unref?.();
          const stop = () => { clearInterval(recheck); closed.abort(); };
          c.req.raw.signal.addEventListener("abort", stop, { once: true });
          const body = stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: stop }));
          return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
        }
        case "result": {
          const value = parseDesktopResult(input);
          resultId = value.id;
          broker.result(owner, value.deviceId, value.id, value.seq, value.data, value.done);
          return c.json({ ok: true });
        }
        case "release":
          // Quitting or restarting ends presence now; consent and preference stay.
          broker.release(owner, parseDesktopPoll(input).deviceId);
          return c.json({ ok: true });
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
        : message === "Slow consumer" ? "slow_consumer"
        : message === "Agent busy on another computer" ? "busy_elsewhere" : "request_rejected";
      if (!c.req.raw.signal.aborted && (action === "account" || action === "poll" || action === "bind" || resultId)) {
        getLogger().warn("desktop.relay.request_rejected", {
          "desktop.action": action, "desktop.operation.id": resultId, "desktop.reason": reason,
        });
      }
      if (reason === "session_changed") return c.json({error:"Sign in again"},403);
      // Another of the person's PCs is running this Mico now: not an account or project problem.
      if (reason === "busy_elsewhere")
        return c.json({ error: "This Mico is working on another computer. Wait for it to finish there, or stop it, then try again.", code: reason }, 409);
      return c.json({ error: "PC connection changed. Reconnect the paired computer." }, 409);
    }
  });
  return Object.assign(() => broker.close(), {
    /** A connected desktop host that advertises agent execution for this scope. */
    hasAgentDevice: (scope: { userId: string; spaceId: string }) => broker.hasAgentDevice(scope),
  });
}
