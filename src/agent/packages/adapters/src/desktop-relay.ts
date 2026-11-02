import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { AdapterContext } from "@rakazo/adapter-kit";
import type { DesktopExecutorBinding, DesktopExecutorOwner, DesktopExecutorPoll } from "../../../../contracts/desktop-executor.js";
import { HOST_COMPUTER_MAX_BYTES, hostComputerDeadlineMs, hostComputerRequest, type HostComputerRequest } from "./host-computer-protocol.js";

const LEASE_MS = 45_000;
const MAX_OPERATIONS = 8;
const MAX_WAITING_OPERATIONS = 32;
const MAX_BOT_OPERATIONS = 8;
const MAX_REQUEST_BUFFER = MAX_OPERATIONS * HOST_COMPUTER_MAX_BYTES;
const MAX_STREAM_BUFFER = 2 * 1024 * 1024;

export class DesktopRelayError extends Error {
  constructor(readonly code: "desktop_disconnected" | "desktop_busy" | "desktop_connection_changed" | "desktop_request_too_large", message: string, readonly status: 409 | 429 | 413 = 409) {
    super(message);
    this.name = "DesktopRelayError";
  }
}
type Binding = DesktopExecutorBinding & DesktopExecutorOwner & { seen: number };
type Operation = {
  id: string; binding: Binding; request: HostComputerRequest; claimed: boolean;
  controller: ReadableStreamDefaultController<Uint8Array>; timer: ReturnType<typeof setTimeout>;
  seq: number; digest: string; closed: boolean; requestBytes: number; dispose(): void;
};
const sameOwner = (a: DesktopExecutorOwner, b: DesktopExecutorOwner) =>
  a.userId === b.userId && a.spaceId === b.spaceId && a.sessionId === b.sessionId;
const key = (scope: { userId: string; spaceId: string }, botId: string) => JSON.stringify([scope.userId, scope.spaceId, botId]);
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
  private accounts = new Map<string, DesktopExecutorOwner & {deviceId:string; generation:string; seen:number}>();
  private bindings = new Map<string, Binding>();
  private operations = new Map<string, Operation>();
  private runs = new Map<string, { generation: string; until: number }>();
  private sweep: ReturnType<typeof setInterval>;
  constructor(private readonly now = Date.now) {
    this.sweep = setInterval(() => this.expire(), 5_000);
    this.sweep.unref();
  }
  private expire() {
    for (const [id, account] of this.accounts) if (this.now() - account.seen > LEASE_MS) this.accounts.delete(id);
    for (const [id, run] of this.runs) if (run.until < this.now()) this.runs.delete(id);
    for (const [id, binding] of this.bindings) if (this.now() - binding.seen > LEASE_MS) {
      this.bindings.delete(id);
      for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Desktop disconnected. Check results before retrying.");
    }
  }
  register(owner: DesktopExecutorOwner, input: {deviceId:string;generation:string}) {
    this.expire();
    const id = JSON.stringify([owner.userId,owner.spaceId]);
    const prior = this.accounts.get(id);
    if (prior && prior.deviceId !== input.deviceId)
      throw new Error("Another computer is already connected to this account");
    if(prior&&(!sameOwner(owner,prior)||prior.generation!==input.generation))this.revoke(prior,prior.deviceId);
    if (!prior && this.accounts.size >= 128) throw new Error("Desktop relay is busy");
    this.accounts.set(id,{...owner,...input,seen:this.now()});
  }
  /** Called only after the API rechecks ownership of this particular bot. */
  connectAccountBot(scope: {userId:string;spaceId:string}, botId: string) {
    this.expire();
    if (this.bindings.has(key(scope,botId))) return;
    const account = this.accounts.get(JSON.stringify([scope.userId,scope.spaceId]));
    if (account) this.bind(account,{deviceId:account.deviceId,generation:account.generation,botId});
  }
  bind(owner: DesktopExecutorOwner, input: DesktopExecutorBinding) {
    this.expire();
    const id = key(owner, input.botId);
    const existing = this.bindings.get(id);
    if (existing && (!sameOwner(owner, existing) || existing.deviceId !== input.deviceId || existing.generation !== input.generation))
      throw new Error("This agent is already connected to a computer. Disconnect it first.");
    if (this.bindings.size >= 128 && !existing) throw new Error("Desktop relay is busy");
    this.bindings.set(id, existing ?? { ...owner, ...input, seen: this.now() });
  }
  available(scope: { userId: string; spaceId: string }, botId: string) {
    this.expire();
    const binding = this.bindings.get(key(scope, botId));
    return !!binding;
  }
  revoke(owner: DesktopExecutorOwner, deviceId: string) {
    const accountKey=JSON.stringify([owner.userId,owner.spaceId]);
    const account=this.accounts.get(accountKey);
    if(account && sameOwner(account,owner) && account.deviceId===deviceId)this.accounts.delete(accountKey);
    for (const [id, binding] of this.bindings) if (sameOwner(owner, binding) && binding.deviceId === deviceId) {
      this.bindings.delete(id);
      for (const op of this.operations.values()) if (op.binding === binding) this.fail(op, "Local computer access was revoked.");
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
    this.expire();
    for (const binding of this.bindings.values()) if (sameOwner(owner, binding) && binding.deviceId === deviceId) binding.seen = this.now();
    const current = [...this.operations.values()].filter(op => sameOwner(owner, op.binding) && op.binding.deviceId === deviceId && !op.closed);
    let claimed = [...this.operations.values()].filter(op => op.claimed && !op.closed).length;
    const pending: Operation[] = [];
    for (const op of current) {
      if (op.claimed || claimed >= MAX_OPERATIONS) continue;
      if (current.filter(other => other.claimed && other.binding === op.binding).length >= 2) continue;
      // Queue before admission; claim exactly once only when an execution slot exists.
      op.claimed = true;
      claimed++;
      pending.push(op);
    }
    // Never advertise queued work as delivered: native recovery treats missing delivered
    // operation IDs as uncertain work and must not execute them again.
    return { bindings:[...this.bindings.values()].filter(b=>sameOwner(owner,b)&&b.deviceId===deviceId).map(b=>({deviceId,botId:b.botId,generation:b.generation})), operations: pending.map(op => ({ id: op.id, binding: { deviceId, botId: op.binding.botId, generation: op.binding.generation }, request: op.request })), active: current.filter(op => op.claimed).map(op => op.id) };
  }
  dispatch(input: HostComputerRequest, context: AdapterContext): Response {
    this.expire();
    const binding = this.bindings.get(key(context, input.botId));
    if (!binding) throw new DesktopRelayError("desktop_disconnected", "The paired PC is disconnected. Start Mycellios Desktop on that computer.");
    const requestBytes = Buffer.byteLength(JSON.stringify(input));
    if (requestBytes > HOST_COMPUTER_MAX_BYTES) throw new DesktopRelayError("desktop_request_too_large", "The PC request is too large.", 413);
    const open = [...this.operations.values()].filter(op => !op.closed);
    if (open.length >= MAX_WAITING_OPERATIONS || open.filter(op => op.binding === binding).length >= MAX_BOT_OPERATIONS || open.reduce((bytes, op) => bytes + op.requestBytes, requestBytes) > MAX_REQUEST_BUFFER)
      throw new DesktopRelayError("desktop_busy", "The PC request queue is full. Wait for current work to finish; this operation was not dispatched.", 429);
    if (input.runId) {
      const runKey = key(context, `${input.botId}:${input.runId}`);
      const previous = this.runs.get(runKey);
      if (previous && previous.generation !== binding.generation) throw new DesktopRelayError("desktop_connection_changed", "This run belongs to a previous project connection. Start a new request.");
      if (!previous && this.runs.size >= 4096) throw new DesktopRelayError("desktop_busy", "The PC request queue is full. Wait for current work to finish; this operation was not dispatched.", 429);
      this.runs.set(runKey, { generation: binding.generation, until: this.now() + 24 * 60 * 60_000 });
    }
    const id = randomUUID();
    let op: Operation;
    const abort = () => this.fail(op, "Desktop command cancelled. Check results before retrying.");
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        const timer = setTimeout(() => this.fail(op, op.claimed ? "Desktop command timed out. Check results before retrying." : "The PC request timed out before dispatch. No command was started."), hostComputerDeadlineMs(input));
        timer.unref();
        op = { id, binding, request: input, requestBytes, claimed: false, controller, timer, seq: -1, digest: "", closed: false,
          dispose: () => { clearTimeout(timer); context.signal.removeEventListener("abort", abort); } };
        this.operations.set(id, op);
      },
      cancel: () => this.fail(op, "Desktop response disconnected. Check results before retrying."),
    }, { highWaterMark: MAX_STREAM_BUFFER, size: chunk => chunk.byteLength });
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    return new Response(body, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
  }
  result(owner: DesktopExecutorOwner, deviceId: string, id: string, seq: number, data: string, done: boolean) {
    const op = this.operations.get(id);
    if (!op || !sameOwner(owner, op.binding) || op.binding.deviceId !== deviceId) throw new Error("Operation unavailable");
    const digest = createHash("sha256").update(data).update(String(done)).digest("hex");
    if (seq === op.seq && digest === op.digest) return; // Lost acknowledgement, not re-execution.
    if (op.closed || !op.claimed || !Number.isSafeInteger(seq) || seq !== op.seq + 1 || data.length > 350_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Invalid Desktop result");
    const bytes = Buffer.from(data, "base64");
    if ((op.controller.desiredSize ?? 0) < bytes.length) { this.fail(op, "Desktop result exceeded its buffer"); throw new Error("Slow consumer"); }
    op.controller.enqueue(bytes);
    op.seq = seq; op.digest = digest;
    if (done) {
      op.closed = true; op.dispose(); op.controller.close();
      // Keep only the final acknowledgement briefly; no command or output retention.
      op.request = { method: "isRunning", botId: op.binding.botId };
      const timer = setTimeout(() => this.operations.delete(id), 30_000); timer.unref();
    }
  }
  private fail(op: Operation, message: string) {
    if (!op || op.closed) return;
    op.closed = true; op.dispose(); this.operations.delete(op.id);
    try { op.controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: message }) + "\n")); op.controller.close(); } catch { /* consumer already gone */ }
  }
  close() {
    clearInterval(this.sweep);
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
export function desktopRelayAvailable(url: string, secret: string) {
  return async (context?: AdapterContext) => {
    if (!context?.botId) return false;
    const body = JSON.stringify({ probe: context.botId, scope: { userId: context.userId, spaceId: context.spaceId }, nonce: randomUUID() });
    const timestamp = String(Date.now());
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-desktop-time": timestamp, "x-desktop-signature": signDesktopRelay(secret, timestamp, body) }, body, signal: AbortSignal.any([context.signal, AbortSignal.timeout(5_000)]), redirect: "error" });
    if (!response.ok) return false;
    const state = await response.json() as {available?: boolean};
    return state.available === true;
  };
}
export { hostComputerRequest };
