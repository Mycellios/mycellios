import { randomUUID } from "node:crypto";
import { withAbort } from "./web-ssrf.js";
import { ModelAccountError, ModelOutputError, TransientModelError } from "@mycellios/adapter-kit";

/** Ephemeral callbacks only. No executable code, paths, stack traces or credentials are logged. */
export type AgentWire = null | boolean | number | string | {
  kind: "undefined" | "bytes" | "date" | "error" | "function" | "promise" | "array" | "object";
  value?: unknown;
  /** On a function: the side that owns it sends no reply when the caller marks the call one-way. */
  mode?: "notify";
};
export type AgentRpcMessage =
  | { kind: "call"; id: string; target: string; args: AgentWire; notify?: true }
  | { kind: "result"; id: string; value: AgentWire; failed: boolean };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const LIMIT = 4096;
const NAME = /^[A-Za-z_$][\w$]{0,63}$/;

/** Names the value's type and key path only, never the value itself. */
function unsupportedValue(value: unknown, path: string): Error {
  const type = typeof value === "object" && value
    ? (Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null)?.constructor?.name
    : typeof value;
  const name = typeof type === "string" && NAME.test(type) ? type : "object";
  return Error(`Unsupported Desktop runtime value (${name} at ${path ? path.slice(0, 240) : "root"})`);
}
/** Model-chosen keys stay out of messages unless they are plain identifiers. */
const keyPath = (path: string, key: string) => NAME.test(key) ? `${path}.${key}` : `${path}[?]`;

export class DesktopAgentRpc {
  private targets = new Map<string, (...args: unknown[]) => unknown>();
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  private received = new Map<string, { fingerprint: string; result: Promise<AgentRpcMessage> }>();
  private outgoing = new Set<Promise<unknown>>();
  /** Functions this side offers as notifications, and the ids it gave them. */
  private notifications = new WeakSet<object>();
  private notifyTargets = new Set<string>();
  private closed = false;
  constructor(private readonly send: (message: AgentRpcMessage) => Promise<void> | void) {}

  /**
   * Offers `fn` as a notification: a caller that understands it sends the call one-way and
   * gets no reply, which saves a relay round trip. Older callers still get their reply. A
   * failure is not reported back; it rejects this side's accept() instead.
   */
  notify<T extends (...args: never[]) => unknown>(fn: T): T {
    this.notifications.add(fn);
    return fn;
  }

  /** Binds an object method to its object, keeping a notification a notification. */
  private bound(fn: (...args: unknown[]) => unknown, self: object) {
    const bound = fn.bind(self);
    if (this.notifications.has(fn)) this.notifications.add(bound);
    return bound;
  }

  encode(value: unknown): AgentWire {
    let count = 0;
    const visit = (v: unknown, depth: number, path: string): AgentWire => {
      if (++count > 100_000 || depth > 48) throw Error("Desktop runtime value exceeds its bound");
      if (v === undefined) return { kind: "undefined" };
      if (v === null || typeof v === "string" || typeof v === "boolean") return v;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "function" || v instanceof Promise) {
        if (this.closed || this.targets.size >= LIMIT) throw Error("Desktop runtime callback limit reached");
        const id = randomUUID();
        this.targets.set(id, typeof v === "function" ? v as (...args: unknown[]) => unknown : () => v);
        // Prevent an asynchronously rejected shell completion from becoming unhandled before use.
        if (v instanceof Promise) void v.catch(() => undefined);
        if (typeof v === "function" && this.notifications.has(v)) {
          this.notifyTargets.add(id);
          return { kind: "function", value: id, mode: "notify" };
        }
        return { kind: typeof v === "function" ? "function" : "promise", value: id };
      }
      if (v instanceof Uint8Array) return { kind: "bytes", value: Buffer.from(v).toString("base64") };
      // Dates travel as ISO instants; invalid dates and other class instances are refused.
      if (v instanceof Date) {
        if (!Number.isFinite(v.getTime())) throw unsupportedValue(v, path);
        return { kind: "date", value: v.toISOString() };
      }
      if (v instanceof Error) return { kind: "error", value: [v.name, v.message] };
      if (Array.isArray(v)) return { kind: "array", value: v.map((x, i) => visit(x, depth + 1, `${path}[${i}]`)) };
      if (typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))
        return { kind: "object", value: Object.entries(v).map(([k, x]) => [k, visit(typeof x === "function" ? this.bound(x as (...args: unknown[]) => unknown, v) : x, depth + 1, keyPath(path, k))]) };
      throw unsupportedValue(v, path);
    };
    return visit(value, 0, "");
  }

  decode(value: unknown): unknown {
    let count = 0;
    const visit = (v: unknown, depth: number): unknown => {
      if (++count > 100_000 || depth > 48) throw Error("Desktop runtime value exceeds its bound");
      if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return v;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Invalid Desktop runtime value");
      const item = v as { kind?: string; value?: unknown; mode?: unknown };
      switch (item.kind) {
        case "undefined": return undefined;
        case "bytes":
          if (typeof item.value !== "string" || item.value.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.value)) break;
          return new Uint8Array(Buffer.from(item.value, "base64"));
        case "date": {
          if (typeof item.value !== "string" || item.value.length > 40) break;
          const date = new Date(item.value);
          if (!Number.isFinite(date.getTime())) break;
          return date;
        }
        case "error": {
          if (!Array.isArray(item.value) || item.value.length !== 2 || item.value.some(x => typeof x !== "string")) break;
          const [name, message] = item.value as [string, string];
          const Type = name === "ModelAccountError" ? ModelAccountError : name === "ModelOutputError" ? ModelOutputError : name === "TransientModelError" ? TransientModelError : Error;
          const error = new Type(message); error.name = name; return error;
        }
        case "function": case "promise": {
          if (!uuid(item.value)) break;
          const target = item.value;
          if (item.mode !== undefined && (item.mode !== "notify" || item.kind !== "function")) break;
          if (item.mode === "notify") return (...args: unknown[]) => this.notifyCall(target, args);
          const call = (...args: unknown[]) => this.call(target, args);
          return item.kind === "promise" ? call() : call;
        }
        case "array":
          if (!Array.isArray(item.value)) break;
          return item.value.map(x => visit(x, depth + 1));
        case "object": {
          if (!Array.isArray(item.value)) break;
          const seen = new Set<string>();
          return Object.fromEntries(item.value.map(pair => {
            if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || seen.has(pair[0])) throw Error("Invalid Desktop runtime field");
            seen.add(pair[0]); return [pair[0], visit(pair[1], depth + 1)];
          }));
        }
      }
      throw Error("Invalid Desktop runtime value");
    };
    return visit(value, 0);
  }

  private call(target: string, args: unknown[]): Promise<unknown> {
    if (this.closed || this.pending.size >= LIMIT) return Promise.reject(Error("Desktop runtime disconnected"));
    const id = randomUUID();
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      void Promise.resolve().then(() => this.send({ kind: "call", id, target, args: this.encode(args) })).catch(error => {
        this.pending.delete(id); reject(error);
      });
    });
    // Some observer callbacks intentionally return void; still keep rejected cancellation
    // observable to awaiters without making those fire-and-forget observers unhandled.
    this.outgoing.add(promise);
    const settled = () => { this.outgoing.delete(promise); };
    void promise.then(settled, settled);
    return promise;
  }

  /** A one-way call: resolves once it is handed to the transport, and expects no reply. */
  private async notifyCall(target: string, args: unknown[]): Promise<void> {
    if (this.closed) throw Error("Desktop runtime disconnected");
    await this.send({ kind: "call", id: randomUUID(), target, args: this.encode(args), notify: true });
  }

  /** Call handling is deliberately concurrent: tool observers can call back during a tool call. */
  async accept(input: unknown): Promise<void> {
    if (this.closed || !input || typeof input !== "object") throw Error("Desktop runtime disconnected");
    const message = input as AgentRpcMessage;
    if (!uuid(message.id)) throw Error("Invalid Desktop runtime callback");
    if (message.kind === "result") {
      if (typeof message.failed !== "boolean") throw Error("Invalid Desktop runtime result");
      const pending = this.pending.get(message.id);
      if (!pending) return; // Late reply after cancellation; never recreate work.
      this.pending.delete(message.id);
      try { const value = this.decode(message.value); if (message.failed) pending.reject(value); else pending.resolve(value); }
      catch (error) { pending.reject(error); }
      return;
    }
    if (message.kind !== "call" || !uuid(message.target)) throw Error("Invalid Desktop runtime callback");
    if (message.notify !== undefined && (message.notify !== true || !this.notifyTargets.has(message.target))) {
      throw Error("Invalid Desktop runtime notification");
    }
    const target = this.targets.get(message.target);
    if (!target || this.received.size >= LIMIT) throw Error("Unknown Desktop runtime callback");
    const fingerprint = JSON.stringify(message);
    let prior = this.received.get(message.id);
    if (prior && prior.fingerprint !== fingerprint) throw Error("Desktop callback id reused");
    if (!prior) {
      const result = Promise.resolve().then(async (): Promise<AgentRpcMessage> => {
        try {
          const args = this.decode(message.args);
          if (!Array.isArray(args)) throw Error("Invalid Desktop runtime arguments");
          return { kind: "result", id: message.id, value: this.encode(await target(...args)), failed: false };
        } catch (error) { return { kind: "result", id: message.id, value: this.encode(error instanceof Error ? error : Error("Desktop runtime callback failed")), failed: true }; }
      });
      prior = { fingerprint, result }; this.received.set(message.id, prior);
    }
    const result = await prior.result;
    if (message.notify) {
      // No reply travels back; a failed notification fails this side instead.
      if (result.kind === "result" && result.failed) throw this.decode(result.value);
      return;
    }
    if (!this.closed) await this.send(result);
  }

  async drainOutgoing(signal: AbortSignal) {
    while (this.outgoing.size) {
      await withAbort(Promise.allSettled(this.outgoing), signal);
    }
  }

  close() {
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(Error("Desktop runtime disconnected; check existing results before retrying"));
    this.pending.clear(); this.targets.clear(); this.received.clear(); this.notifyTargets.clear();
  }
}
