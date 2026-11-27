import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdapterContext } from "@mycellios/adapter-kit";
import { getLogger } from "@mycellios/logging";
import { desktopLegacyFailureCode } from "@mycellios/contracts";
import { ComputerUpdatingError, DesktopUnreachableError } from "./computer-errors.js";
import type { DesktopExecutorBinding, DesktopExecutorOwner, DesktopExecutorPoll } from "../../../../contracts/desktop-executor.js";
import { HOST_COMPUTER_MAX_BYTES, hostComputerDeadlineMs, hostComputerRequest, type HostComputerRequest } from "./host-computer-protocol.js";

// Presence outlasts a stalled API: relay requests can wait 20-40 s for a busy
// database, and Desktop keeps running work through stalls up to 85 s.
const LEASE_MS = 90_000;
const MAX_OPERATIONS = 8;
const MAX_WAITING_OPERATIONS = 32;
const MAX_BOT_OPERATIONS = 8;
const MAX_REQUEST_BUFFER = MAX_OPERATIONS * HOST_COMPUTER_MAX_BYTES;
const MAX_STREAM_BUFFER = 2 * 1024 * 1024;
/** A handoff nobody renews ends by itself, so a lost deployment never leaves PCs refused. */
export const DESKTOP_RELAY_HANDOFF_MS = 15 * 60_000;
const HANDOFF_REFUSAL = "The server is moving to a new version. This operation was not dispatched; it continues once the PC reconnects.";
const LOST_DELIVERY = Buffer.from(JSON.stringify({
  error: "Desktop delivery was interrupted. Check results before retrying.",
}) + "\n").toString("base64");

export class DesktopRelayError extends Error {
  constructor(readonly code: "desktop_disconnected" | "desktop_busy" | "desktop_connection_changed" | "desktop_request_too_large" | "desktop_updating", message: string, readonly status: 409 | 429 | 413 | 503 = 409) {
    super(message);
    this.name = "DesktopRelayError";
  }
}
type Binding = DesktopExecutorBinding & DesktopExecutorOwner & { seen: number };
type Operation = {
  id: string; binding: Binding; request: HostComputerRequest; claimed: boolean;
  method: HostComputerRequest["method"]; runId?: string;
  controller: ReadableStreamDefaultController<Uint8Array>; timer: ReturnType<typeof setTimeout>;
  seq: number; digest: string; closed: boolean; requestBytes: number; dispose(): void;
  /** Delivered on the PC's agent channel instead of a poll; redelivered there until acknowledged. */
  channel?: boolean;
};
/** How long one agent channel stays open before the PC opens the next one. */
export const DESKTOP_CHANNEL_MS = 4 * 60_000;
/** A line at least this often keeps proxies and the PC's idle watchdog from closing a quiet channel. */
export const DESKTOP_CHANNEL_KEEPALIVE_MS = 15_000;
const CHANNEL_BUFFER = 16 * 1024 * 1024;
type Channel = { owner: DesktopExecutorOwner; deviceId: string; write(line: unknown): boolean; close(): void };
const sameOwner = (a: DesktopExecutorOwner, b: DesktopExecutorOwner) =>
  a.userId === b.userId && a.spaceId === b.spaceId && a.sessionId === b.sessionId;
const key = (scope: { userId: string; spaceId: string }, botId: string) => JSON.stringify([scope.userId, scope.spaceId, botId]);
/** A PC as remembered at rest: never the raw device id Desktop reports. */
export function desktopDeviceKey(deviceId: string) {
  return createHash("sha256").update(`mycellios-desktop-device-v1\n${deviceId}`).digest("hex");
}
export function desktopRelayKey(secret: string) {
  return createHmac("sha256", secret).update("mycellios-desktop-executor-v1").digest("hex");
}
export function signDesktopRelay(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
}
export function verifyDesktopRelay(secret: string, timestamp: string, body: string, signature: string, now = Date.now()) {
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 30_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(signDesktopRelay(secret, timestamp, body)));
}

/** A single API instance owns the volatile relay. A restart fails work; it never replays it. */
export class DesktopRelayBroker {
  /** `workspaces`: SHA-256 keys of the Mico folders this PC reported; absent from older Desktops. */
  private accounts = new Map<string, DesktopExecutorOwner & {deviceId:string; generation:string; seen:number; agentExecution?:1; workspaces?: ReadonlySet<string>}>();
  private bindings = new Map<string, Binding>();
  private operations = new Map<string, Operation>();
  private runs = new Map<string, { generation: string; until: number; agentSessions?: Record<string, string> }>();
  private sweep: ReturnType<typeof setInterval>;
  private waiting = new Map<string, Set<() => void>>();
  private polling = new Set<string>();
  /** Open agent channels, one per signed-in PC session (see attachChannel). */
  private channels = new Map<string, Channel>();
  private handoffUntil = 0;
  private pollKey(owner: DesktopExecutorOwner, deviceId: string) { return JSON.stringify([owner.userId, owner.spaceId, owner.sessionId, deviceId]); }
  private wake(owner: DesktopExecutorOwner, deviceId: string) { for (const finish of this.waiting.get(this.pollKey(owner, deviceId)) ?? []) finish(); }
  constructor(private readonly now = Date.now) {
    this.sweep = setInterval(() => this.expire(), 5_000);
    this.sweep.unref();
  }
  private expire() {
    const now = this.now();
    // A desktop poll refreshes the binding. That heartbeat is the PC's presence:
    // the account lease must not lapse out from under a run whose command just finished.
    for (const account of this.accounts.values()) {
      const heartbeat = [...this.bindings.values()].some((binding) =>
        sameOwner(binding, account) && binding.deviceId === account.deviceId && now - binding.seen <= LEASE_MS);
      if (heartbeat) account.seen = now;
    }
    for (const [id, account] of this.accounts) if (now - account.seen > LEASE_MS) this.accounts.delete(id);
    for (const [id, run] of this.runs) if (run.until < this.now()) this.runs.delete(id);
    for (const [id, binding] of this.bindings) if (this.now() - binding.seen > LEASE_MS) {
      this.bindings.delete(id);
      for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Desktop disconnected. Check results before retrying.");
    }
  }
  private accountKey(scope: {userId:string;spaceId:string;sessionId:string}, deviceId: string) {
    return JSON.stringify([scope.userId, scope.spaceId, deviceId, scope.sessionId]);
  }
  register(owner: DesktopExecutorOwner, input: {deviceId:string;generation:string;agentExecution?:1;workspaces?:readonly string[]}) {
    this.expire();
    for (const prior of [...this.accounts.values()]) {
      if (prior.userId !== owner.userId || prior.spaceId !== owner.spaceId || prior.deviceId !== input.deviceId) continue;
      if (sameOwner(prior, owner) && prior.generation === input.generation) continue;
      if (this.polling.has(this.pollKey(prior, input.deviceId))) continue;
      this.revoke(prior, input.deviceId);
    }
    const id = this.accountKey(owner, input.deviceId);
    const current = this.accounts.get(id);
    if (current && current.generation !== input.generation && this.polling.has(this.pollKey(owner, input.deviceId))) {
      current.seen = this.now();
      if (input.agentExecution === 1) current.agentExecution = 1;
      return;
    }
    if (!current && this.accounts.size >= 128) throw new Error("Desktop relay is busy");
    const devices = new Set([...this.accounts.values()].filter(account => account.userId === owner.userId && account.spaceId === owner.spaceId).map(account => account.deviceId));
    if (!devices.has(input.deviceId) && devices.size >= 8) throw new Error("Desktop relay is busy");
    const samePc = !!current && current.generation === input.generation;
    const agentExecution = input.agentExecution ?? (samePc ? current.agentExecution : undefined);
    const workspaces = input.workspaces ? new Set(input.workspaces) : samePc ? current.workspaces : undefined;
    this.accounts.set(id,{...owner,deviceId:input.deviceId,generation:input.generation,...(agentExecution ? {agentExecution} : {}),...(workspaces ? {workspaces} : {}),seen:this.now()});
  }
  private liveAccounts(scope: {userId:string;spaceId:string}) {
    return [...this.accounts.values()].filter(account => account.userId === scope.userId && account.spaceId === scope.spaceId);
  }
  /**
   * The PC that runs a Mico nobody connected explicitly. One online PC takes every
   * Mico, as before. With several, the PC the owner last chose for it (`chosen`, a
   * desktopDeviceKey remembered across restarts) takes it while online; otherwise
   * only the one PC reporting this Mico's folder may: none or several leave it
   * unresolved, never guessed.
   */
  private owningAccount(scope: {userId:string;spaceId:string}, botId: string, chosen?: string) {
    const live = this.liveAccounts(scope);
    if (live.length === 1) return live[0];
    const newest = (accounts: typeof live) => accounts.reduce((latest, account) => account.seen > latest.seen ? account : latest);
    const picked = chosen ? live.filter(account => desktopDeviceKey(account.deviceId) === chosen) : [];
    if (picked.length) return newest(picked);
    const folder = createHash("sha256").update(botId).digest("hex");
    const holders = live.filter(account => account.workspaces?.has(folder));
    if (new Set(holders.map(account => account.deviceId)).size !== 1) return undefined;
    return newest(holders);
  }
  needsExecutionPreference(owner: DesktopExecutorOwner, input: {deviceId:string;generation:string}) {
    const account = this.accounts.get(this.accountKey(owner, input.deviceId));
    return !account || !sameOwner(owner, account) || account.generation !== input.generation || account.agentExecution !== 1;
  }
  /**
   * Several PCs of this account and Space are online and none holds this Mico, so
   * only a remembered owner choice can settle which one runs it.
   */
  needsChoice(scope: {userId:string;spaceId:string}, botId: string) {
    this.expire();
    return !this.bindings.has(key(scope, botId)) && this.liveAccounts(scope).length > 1;
  }
  /** Called only after the API rechecks ownership of this particular bot. */
  connectAccountBot(scope: {userId:string;spaceId:string}, botId: string, chosen?: string) {
    this.expire();
    if (this.bindings.has(key(scope,botId))) return;
    const account = this.owningAccount(scope, botId, chosen);
    if (account) this.bind(account,{deviceId:account.deviceId,generation:account.generation,botId});
  }
  /**
   * A PC of this account and Space is online, but none could take this Mico.
   * That is a choice for the owner to make, not an offline PC.
   */
  unresolved(scope: { userId: string; spaceId: string }, botId: string) {
    this.expire();
    return !this.bindings.has(key(scope, botId)) && this.liveAccounts(scope).length > 0;
  }
  /** True when the Mico was not on this PC before: an explicit bind is then a new owner choice. */
  bind(owner: DesktopExecutorOwner, input: DesktopExecutorBinding): boolean {
    this.expire();
    const id = key(owner, input.botId);
    const existing = this.bindings.get(id);
    const sameAccount = !!existing && existing.userId === owner.userId && existing.spaceId === owner.spaceId;
    if (existing && !sameAccount) throw new Error("This agent is already connected to a computer. Disconnect it first.");
    if (existing && (!sameOwner(owner, existing) || existing.deviceId !== input.deviceId || existing.generation !== input.generation)) {
      const busy = [...this.operations.values()].some(op => op.binding === existing && !op.closed);
      if (busy) throw new Error("Agent busy on another computer");
      this.bindings.set(id, { ...owner, ...input, seen: this.now() });
      return existing.deviceId !== input.deviceId;
    }
    if (this.bindings.size >= 128 && !existing) throw new Error("Desktop relay is busy");
    this.bindings.set(id, existing ?? { ...owner, ...input, seen: this.now() });
    return !existing;
  }
  available(scope: { userId: string; spaceId: string }, botId: string) {
    this.expire();
    const binding = this.bindings.get(key(scope, botId));
    return !!binding;
  }
  agentAvailable(scope: { userId: string; spaceId: string }, botId: string) {
    if (!this.available(scope, botId)) return false;
    const binding = this.bindings.get(key(scope, botId));
    if (!binding) return false;
    const account = this.accounts.get(this.accountKey(binding, binding.deviceId));
    return !!account && account.agentExecution === 1 && account.deviceId === binding.deviceId && account.generation === binding.generation && sameOwner(account, binding);
  }
  hasAgentDevice(scope: { userId: string; spaceId: string }) {
    return this.liveAccounts(scope).some(account => account.agentExecution === 1);
  }
  revoke(owner: DesktopExecutorOwner, deviceId: string) {
    const accountKey=this.accountKey(owner, deviceId);
    const account=this.accounts.get(accountKey);
    if(account && sameOwner(account,owner))this.accounts.delete(accountKey);
    this.closeChannel(owner, deviceId);
    for (const [id, binding] of this.bindings) if (sameOwner(owner, binding) && binding.deviceId === deviceId) {
      this.bindings.delete(id);
      for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Local computer access was revoked.");
    }
  }
  /**
   * The PC is quitting or restarting: end its presence now instead of after the
   * lease expires, so no new work waits for a poll that will never come. Unlike
   * revoke, this keeps the owner's consent and execution preference.
   */
  release(owner: DesktopExecutorOwner, deviceId: string) {
    const accountKey = this.accountKey(owner, deviceId);
    const account = this.accounts.get(accountKey);
    if (account && sameOwner(account, owner)) this.accounts.delete(accountKey);
    this.closeChannel(owner, deviceId);
    for (const [id, binding] of this.bindings) if (sameOwner(owner, binding) && binding.deviceId === deviceId) {
      this.bindings.delete(id);
      for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Desktop disconnected. Check results before retrying.");
    }
  }
  ownedBindings(owner: DesktopExecutorOwner, deviceId: string) {
    return [...this.bindings.values()].filter(binding => sameOwner(owner, binding) && binding.deviceId === deviceId).map(binding => binding.botId);
  }
  revokeBot(owner: DesktopExecutorOwner, botId: string) {
    const binding = this.bindings.get(key(owner, botId));
    if (!binding || !sameOwner(owner, binding)) return;
    this.bindings.delete(key(owner, botId));
    for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Project access was revoked.");
  }
  poll(owner: DesktopExecutorOwner, deviceId: string): DesktopExecutorPoll {
    return this.pollState(owner, deviceId, true);
  }
  private pollState(owner: DesktopExecutorOwner, deviceId: string, claim: boolean, verifiedBots?: ReadonlySet<string>): DesktopExecutorPoll {
    this.expire();
    for (const binding of this.bindings.values()) if (sameOwner(owner, binding) && binding.deviceId === deviceId) binding.seen = this.now();
    // Channel operations travel on the agent channel and are acknowledged there, never through a poll.
    const current = [...this.operations.values()].filter(op => sameOwner(owner, op.binding) && op.binding.deviceId === deviceId && !op.closed && !op.channel);
    const lane = (op: Operation) => op.request.method === "agentMessage" ? "control" : op.request.method === "agentRun" ? "agent" : "computer";
    const limits = { control: 8, agent: 4, computer: MAX_OPERATIONS };
    // A callback reply stays claimed until the PC acknowledges it, so two per Mico made a
    // third reply wait a whole round trip. Control matches its dispatch bound per Mico.
    const perMico = { control: 4, agent: 2, computer: 2 };
    const claimed = { control: 0, agent: 0, computer: 0 };
    for (const op of this.operations.values()) if (op.claimed && !op.closed && !op.channel) claimed[lane(op)]++;
    const pending: Operation[] = [];
    const perBinding = new Map<Binding, Record<ReturnType<typeof lane>, number>>();
    for (const op of current) {
      if (!op.claimed) continue;
      const slots = perBinding.get(op.binding) ?? { control: 0, agent: 0, computer: 0 };
      slots[lane(op)]++;
      perBinding.set(op.binding, slots);
    }
    for (const op of current) {
      const group = lane(op);
      if (op.claimed || (verifiedBots && !verifiedBots.has(op.binding.botId)) || claimed[group] >= limits[group]) continue;
      const slots = perBinding.get(op.binding) ?? { control: 0, agent: 0, computer: 0 };
      if (slots[group] >= perMico[group]) continue;
      if (claim) op.claimed = true;
      claimed[group]++;
      slots[group]++;
      perBinding.set(op.binding, slots);
      pending.push(op);
    }
    // Never advertise queued work as delivered: native recovery treats missing delivered
    // operation IDs as uncertain work and must not execute them again.
    return { bindings:[...this.bindings.values()].filter(b=>sameOwner(owner,b)&&b.deviceId===deviceId).map(b=>({deviceId,botId:b.botId,generation:b.generation})), operations: pending.map(op => ({ id: op.id, binding: { deviceId, botId: op.binding.botId, generation: op.binding.generation }, request: op.request })), active: current.filter(op => op.claimed).map(op => op.id) };
  }
  async waitPoll(owner: DesktopExecutorOwner, deviceId: string, signal: AbortSignal, wait?: boolean, active: string[] = [], authorize?: () => Promise<ReadonlySet<string> | void>): Promise<DesktopExecutorPoll> {
    const id = this.pollKey(owner, deviceId);
    if (this.polling.has(id) || this.polling.size >= 128) throw Error("Desktop poll is already pending");
    this.polling.add(id);
    try {
      signal.throwIfAborted();
      const state = this.pollState(owner, deviceId, false);
      if (wait && !state.operations.length && active.every(id => state.active.includes(id))) {
        const account = this.accounts.get(this.accountKey(owner, deviceId));
        if (!(account && sameOwner(owner,account)) && !this.ownedBindings(owner,deviceId).length) throw Error("Desktop device is not connected");
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); this.waiting.delete(id); resolve(); };
          const timer = setTimeout(finish, 15_000); timer.unref();
          this.waiting.set(id, new Set([finish])); signal.addEventListener("abort", finish, {once:true});
          if (signal.aborted) finish();
        });
      }
      const verifiedBots = authorize && !signal.aborted ? await authorize() : undefined;
      if (signal.aborted) return { ...state, operations: [] };
      // Only the response that can deliver the batch gets to claim it.
      return this.pollState(owner, deviceId, true, verifiedBots ?? undefined);
    } finally { this.polling.delete(id); }
  }
  /**
   * Opens this PC's agent channel (specs/desktop-agent-channel/spec.md phase 3): one streamed
   * response that carries every message for its agent runs as it is dispatched, instead of a
   * held poll answering, then being re-armed, once per message. The PC acknowledges each one
   * with its result, as before. A newer channel replaces an older one. When a channel ends,
   * operations it delivered that the PC has not acknowledged go back to the poll, which the PC
   * already holds; the PC skips any operation id it started, so none runs twice. The caller authenticates the PC when it opens the channel
   * and again while it stays open.
   */
  attachChannel(owner: DesktopExecutorOwner, deviceId: string, signal: AbortSignal): ReadableStream<Uint8Array> {
    this.expire();
    const account = this.accounts.get(this.accountKey(owner, deviceId));
    if (!(account && sameOwner(owner, account)) && !this.ownedBindings(owner, deviceId).length) throw Error("Desktop device is not connected");
    const id = this.pollKey(owner, deviceId);
    if (!this.channels.has(id) && this.channels.size >= 128) throw Error("Desktop relay is busy");
    this.channels.get(id)?.close();
    const encoder = new TextEncoder();
    let channel!: Channel;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let lifetime: ReturnType<typeof setTimeout> | undefined;
    const end = () => {
      clearInterval(keepalive); clearTimeout(lifetime); signal.removeEventListener("abort", channel.close);
      if (this.channels.get(id) !== channel) return;
      this.channels.delete(id);
      // What it carried and the PC has not acknowledged goes back to the poll. The PC skips any
      // operation it already started, so a message is never run twice.
      let returned = false;
      for (const op of this.operations.values())
        if (op.channel && !op.closed && sameOwner(owner, op.binding) && op.binding.deviceId === deviceId) {
          op.channel = false; op.claimed = false; returned = true;
        }
      if (returned) this.wake(owner, deviceId);
    };
    return new ReadableStream<Uint8Array>({
      start: controller => {
        let open = true;
        channel = {
          owner, deviceId,
          write: line => {
            if (!open) return false;
            const bytes = encoder.encode(JSON.stringify(line) + "\n");
            // A PC that stops reading loses this channel; its messages wait for the next one.
            if ((controller.desiredSize ?? 0) < bytes.byteLength) { channel.close(); return false; }
            controller.enqueue(bytes);
            return true;
          },
          close: () => {
            if (!open) return;
            open = false; end();
            try { controller.close(); } catch { /* the PC already went away */ }
          },
        };
        this.channels.set(id, channel);
        keepalive = setInterval(() => channel.write({ keepalive: 1 }), DESKTOP_CHANNEL_KEEPALIVE_MS); keepalive.unref();
        lifetime = setTimeout(() => channel.close(), DESKTOP_CHANNEL_MS); lifetime.unref();
        signal.addEventListener("abort", channel.close, { once: true });
        if (signal.aborted) { channel.close(); return; }
        channel.write({ keepalive: 1 });
      },
      cancel: () => channel.close(),
    }, { highWaterMark: CHANNEL_BUFFER, size: chunk => chunk.byteLength });
  }
  private channelLine(op: Operation) {
    return { id: op.id, binding: { deviceId: op.binding.deviceId, botId: op.binding.botId, generation: op.binding.generation }, request: op.request };
  }
  /** Hands a message to the PC's open agent channel; false leaves it for the poll. */
  private sendOnChannel(op: Operation) {
    const channel = this.channels.get(this.pollKey(op.binding, op.binding.deviceId));
    if (!channel || !sameOwner(channel.owner, op.binding)) return false;
    op.claimed = true; op.channel = true;
    // A channel that closed meanwhile keeps the message for the next one.
    channel.write(this.channelLine(op));
    return true;
  }
  /** Ends this PC's agent channel (a signed-out or revoked session). */
  closeChannel(owner: DesktopExecutorOwner, deviceId: string) {
    this.channels.get(this.pollKey(owner, deviceId))?.close();
  }
  /**
   * A new API version takes over the PC connections (a deploy's handoff, see the API's
   * /internal/desktop-relay/handoff). Until it ends, nothing new reaches a PC through this
   * instance: new work hears "updating", so its turn pauses and continues once the PC has
   * reconnected to the new version. Requests of agent runs already open here (their
   * callbacks) still pass, so those runs finish where they started. A handoff lasts DESKTOP_RELAY_HANDOFF_MS
   * unless renewed; `false` ends it now (a rollback).
   */
  handOff(start: boolean) {
    this.handoffUntil = start ? this.now() + DESKTOP_RELAY_HANDOFF_MS : 0;
  }
  handingOff() {
    return this.handoffUntil > this.now();
  }
  /** What a handoff waits for: the operations still open here and the PCs connected to it. */
  handoffState() {
    this.expire();
    const open = [...this.operations.values()].filter(op => !op.closed);
    const handingOff = this.handingOff();
    return {
      handingOff,
      ...(handingOff ? { handoffEndsAt: new Date(this.handoffUntil).toISOString() } : {}),
      openOperations: open.length,
      deliveredOperations: open.filter(op => op.claimed).length,
      agentRuns: open.filter(op => op.method === "agentRun").length,
      agentChannels: this.channels.size,
      connectedComputers: new Set([...this.accounts.values()].map(account =>
        JSON.stringify([account.userId, account.spaceId, account.deviceId]))).size,
    };
  }
  dispatch(input: HostComputerRequest, context: AdapterContext): Response {
    this.expire();
    if (this.handingOff() && !(input.runId && [...this.operations.values()].some(op =>
      !op.closed && op.method === "agentRun" && op.runId === input.runId && op.binding.botId === input.botId &&
      op.binding.userId === context.userId && op.binding.spaceId === context.spaceId)))
      throw new DesktopRelayError("desktop_updating", HANDOFF_REFUSAL, 503);
    const binding = this.bindings.get(key(context, input.botId));
    const started = input.runId ? this.runs.get(key(context, `${input.botId}:${input.runId}`)) : undefined;
    if (input.method === "agentRun" && !this.agentAvailable(context, input.botId))
      throw new DesktopRelayError("desktop_disconnected", "Desktop agent execution is unavailable");
    if (input.method === "agentMessage" && !this.agentAvailable(context, input.botId)) {
      // The command already ran inside this dispatch. A missed heartbeat must not
      // drop the result or make the cloud report the executor as unavailable.
      if (!started || !binding) throw new DesktopRelayError("desktop_disconnected", "Desktop agent execution is unavailable");
      getLogger().warn("desktop.agent.result_while_unavailable", { "run.id": input.runId, "desktop.method": input.method });
    }
    if (!binding) throw new DesktopRelayError("desktop_disconnected", "The paired PC is disconnected. Start Mycellios Desktop on that computer.");
    const requestBytes = Buffer.byteLength(JSON.stringify(input));
    if (requestBytes > HOST_COMPUTER_MAX_BYTES) throw new DesktopRelayError("desktop_request_too_large", "The PC request is too large.", 413);
    const open = [...this.operations.values()].filter(op => !op.closed);
    const control = input.method === "agentMessage";
    const peers = open.filter(op => (op.request.method === "agentMessage") === control);
    // Messages to a PC with an agent channel go straight to it, so they no longer wait for the
    // shared poll slots: only that PC's own bound applies to them.
    const viaChannel = control && this.channels.has(this.pollKey(binding, binding.deviceId));
    if ((viaChannel ? false : peers.filter(op => !op.channel).length >= (control ? 8 : MAX_WAITING_OPERATIONS)) || peers.filter(op => op.binding === binding).length >= (control ? 4 : MAX_BOT_OPERATIONS) || peers.reduce((bytes, op) => bytes + op.requestBytes, requestBytes) > (control ? 16 * 1024 * 1024 : MAX_REQUEST_BUFFER))
      throw new DesktopRelayError("desktop_busy", "The PC request queue is full. Wait for current work to finish; this operation was not dispatched.", 429);
    if (input.runId) {
      const runKey = key(context, `${input.botId}:${input.runId}`);
      const previous = this.runs.get(runKey);
      const segment = input.method === "agentRun" ? input.segmentId ?? "initial" : undefined;
      if (segment && (previous?.agentSessions?.[segment] || open.some(op => op.binding === binding && op.method === "agentRun" && op.runId === input.runId)))
        throw new DesktopRelayError("desktop_connection_changed", "This Desktop run was already dispatched. Check existing results before retrying.");
      if (segment && Object.keys(previous?.agentSessions ?? {}).length >= 256)
        throw new DesktopRelayError("desktop_busy", "The PC request queue is full. Wait for current work to finish; this operation was not dispatched.", 429);
      if (previous && previous.generation !== binding.generation) throw new DesktopRelayError("desktop_connection_changed", "This run belongs to a previous project connection. Start a new request.");
      if (!previous && this.runs.size >= 4096) throw new DesktopRelayError("desktop_busy", "The PC request queue is full. Wait for current work to finish; this operation was not dispatched.", 429);
      this.runs.set(runKey, { ...previous, generation: binding.generation, until: this.now() + 24 * 60 * 60_000,
        ...(input.method === "agentRun" ? { agentSessions: { ...previous?.agentSessions, [segment!]: input.sessionId } } : {}) });
    }
    const id = randomUUID();
    let op: Operation;
    const abort = () => this.fail(op, "Desktop command cancelled. Check results before retrying.");
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const timer = setTimeout(() => this.fail(op, op.claimed ? "Desktop command timed out. Check results before retrying." : "The PC request timed out before dispatch. No command was started."), hostComputerDeadlineMs(input));
        timer.unref();
        op = { id, binding, request: input, method: input.method, runId: input.runId, requestBytes, claimed: false, controller, timer, seq: -1, digest: "", closed: false,
          dispose: () => { clearTimeout(timer); context.signal.removeEventListener("abort", abort); } };
        this.operations.set(id, op);
        if (!(control && this.sendOnChannel(op))) this.wake(binding, binding.deviceId);
      },
      cancel: () => this.fail(op, "Desktop response disconnected. Check results before retrying."),
    }, { highWaterMark: MAX_STREAM_BUFFER, size: chunk => chunk.byteLength });
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-mycellios-desktop-operation": id } });
  }
  result(owner: DesktopExecutorOwner, deviceId: string, id: string, seq: number, data: string, done: boolean) {
    const op = this.operations.get(id);
    if (!op || !sameOwner(owner, op.binding) || op.binding.deviceId !== deviceId) throw new Error("Operation unavailable");
    const digest = createHash("sha256").update(data).update(String(done)).digest("hex");
    if (seq === op.seq && digest === op.digest) return; // Lost acknowledgement, not re-execution.
    // Desktop 0.3.24 can report an orphan from a poll snapshot taken just
    // before this operation finished. It must not lose the rest of that batch.
    const lostDelivery = seq === 0 && done && data === LOST_DELIVERY;
    if (op.closed && lostDelivery) return;
    if (op.closed || !op.claimed || !Number.isSafeInteger(seq) || seq !== op.seq + 1 || data.length > 350_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      this.logFailure(op, op.closed ? "result_after_close" : !op.claimed ? "result_before_dispatch" : "invalid_result_sequence_or_frame");
      throw new Error("Invalid Desktop result");
    }
    if (lostDelivery) this.logFailure(op, "delivery_lost");
    const bytes = Buffer.from(data, "base64");
    if ((op.controller.desiredSize ?? 0) < bytes.length) { this.fail(op, "Desktop result exceeded its buffer"); throw new Error("Slow consumer"); }
    op.controller.enqueue(bytes);
    op.seq = seq; op.digest = digest;
    // An accepted, owner-checked result proves the PC is alive as much as a poll does.
    op.binding.seen = this.now();
    if (done) {
      op.closed = true; op.dispose(); op.controller.close();
      // A held poll only needs waking for work it delivers; channel work never re-arms it.
      if (!op.channel) this.wake(op.binding, op.binding.deviceId);
      // Keep only the final acknowledgement briefly; no command or output retention.
      op.request = { method: "isRunning", botId: op.binding.botId };
      const timer = setTimeout(() => this.operations.delete(id), 30_000); timer.unref();
    }
  }
  private fail(op: Operation, message: string) {
    if (!op || op.closed) return;
    // All messages passed by the broker are static and contain no request data.
    this.logFailure(op, message);
    op.closed = true; op.dispose(); this.operations.delete(op.id);
    // A start the PC never received may be dispatched again once it reconnects.
    if (!op.claimed && op.request.method === "agentRun" && op.runId) {
      const runKey = key(op.binding, `${op.binding.botId}:${op.runId}`);
      const run = this.runs.get(runKey), segment = op.request.segmentId ?? "initial";
      if (run?.agentSessions && run.agentSessions[segment] === op.request.sessionId) {
        const agentSessions = { ...run.agentSessions };
        delete agentSessions[segment];
        this.runs.set(runKey, { ...run, agentSessions });
      }
    }
    this.wake(op.binding, op.binding.deviceId);
    try { op.controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: message, code: desktopLegacyFailureCode(message), operationId: op.id, dispatched: op.claimed }) + "\n")); op.controller.close(); } catch { /* consumer already gone */ }
  }
  private logFailure(op: Operation, reason: string) {
    getLogger().warn("desktop.relay.operation_failed", {
      "desktop.operation.id": op.id, "desktop.method": op.method, "run.id": op.runId,
      "desktop.reason": reason, "desktop.claimed": op.claimed, "desktop.last_sequence": op.seq,
    });
  }
  close() {
    for (const callbacks of this.waiting.values()) for (const finish of callbacks) finish();
    this.waiting.clear();
    clearInterval(this.sweep);
    for (const channel of [...this.channels.values()]) channel.close();
    for (const op of this.operations.values()) this.fail(op, "Desktop relay restarted. Check results before retrying.");
    this.operations.clear(); this.bindings.clear(); this.runs.clear(); this.accounts.clear();
  }
}

export function desktopRelayTransport(url: string, secret: string) {
  return async (request: HostComputerRequest, context: AdapterContext) => {
    const body = JSON.stringify({ request, scope: { userId: context.userId, spaceId: context.spaceId }, nonce: randomUUID() });
    const timestamp = String(Date.now());
    return fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-desktop-time": timestamp, "x-desktop-signature": signDesktopRelay(secret, timestamp, body) }, body, signal: context.signal, redirect: "error" });
  };
}
/**
 * Ask the relay whether this Mico's PC is available: its JSON answer, or null when it
 * refused the probe (404 when the relay or the Mico is unavailable, or a rejected
 * request). A timeout, a lost connection or a busy relay (a failed lookup answers 409,
 * then 429 and 5xx) is no answer at all: it throws DesktopUnreachableError, never
 * "offline". The caller's own cancellation stays a cancellation.
 */
async function probeDesktopRelay(url: string, secret: string, context: AdapterContext, extra: { agentExecution?: 1 } = {}): Promise<unknown> {
  const body = JSON.stringify({ probe: context.botId, ...extra, scope: { userId: context.userId, spaceId: context.spaceId }, nonce: randomUUID() });
  const timestamp = String(Date.now());
  let response: Response;
  let state: unknown = null;
  try {
    response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-desktop-time": timestamp, "x-desktop-signature": signDesktopRelay(secret, timestamp, body) }, body, signal: AbortSignal.any([context.signal, AbortSignal.timeout(5_000)]), redirect: "error" });
    if (response.ok) state = await response.json();
    else await response.body?.cancel();
  } catch (error) {
    if (context.signal.aborted) throw error;
    throw new DesktopUnreachableError({ cause: error });
  }
  // A relay handing its PCs to a new server version: the turn waits for it, as for a PC update.
  if (response.headers.get("x-mycellios-desktop-error") === "desktop_updating") throw new ComputerUpdatingError(false);
  if (response.status === 409 || response.status === 429 || response.status >= 500) throw new DesktopUnreachableError();
  return state;
}
/**
 * connected: a PC holds this Mico. unresolved: a PC of the account and Space is
 * online but none could take this Mico (an older API never reports it). offline: the
 * relay answered that no PC holds it. A relay that gives no answer throws
 * DesktopUnreachableError (see probeDesktopRelay): it is never "offline".
 */
export type DesktopPresence = "connected" | "unresolved" | "offline";
export function desktopRelayPresence(url: string, secret: string) {
  return async (context?: AdapterContext): Promise<DesktopPresence> => {
    if (!context?.botId) return "offline";
    const state = await probeDesktopRelay(url, secret, context) as { available?: unknown; unresolved?: unknown } | null;
    return state?.available === true ? "connected" : state?.unresolved === true ? "unresolved" : "offline";
  };
}
/** Whether a PC holds this Mico now; a relay that gives no answer still throws. */
export function desktopRelayAvailable(url: string, secret: string) {
  const presence = desktopRelayPresence(url, secret);
  return async (context?: AdapterContext) => await presence(context) === "connected";
}
export function desktopAgentSelection(url: string, secret: string) {
  return async (context: AdapterContext): Promise<{ available: boolean; preferred: boolean; unresolved?: boolean }> => {
    if (!context.botId) throw Error("Desktop execution requires an owned Mico");
    const state = await probeDesktopRelay(url, secret, context, { agentExecution: 1 }) as { available?: unknown; preferred?: unknown; agentExecution?: unknown; unresolved?: unknown } | null;
    if (!state) throw Error("Desktop execution admission could not be checked");
    if (state.agentExecution !== 1 || typeof state.available !== "boolean" || typeof state.preferred !== "boolean") throw Error("Desktop execution protocol unavailable");
    return { available: state.available, preferred: state.preferred, ...(state.unresolved === true ? { unresolved: true } : {}) };
  };
}
export { hostComputerRequest };
