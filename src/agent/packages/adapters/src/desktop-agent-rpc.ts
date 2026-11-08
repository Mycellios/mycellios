import { randomUUID } from "node:crypto";
import { withAbort } from "./web-ssrf.js";
import { ModelAccountError, ModelOutputError, TransientModelError } from "@rakazo/adapter-kit";

/** Ephemeral callbacks only. No executable code, paths, stack traces or credentials are logged. */
export type AgentWire = null | boolean | number | string | {
  kind: "undefined" | "bytes" | "error" | "function" | "promise" | "array" | "object";
  value?: unknown;
};
export type AgentRpcMessage =
  | { kind: "call"; id: string; target: string; args: AgentWire }
  | { kind: "result"; id: string; value: AgentWire; failed: boolean };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const LIMIT = 4096;

export class DesktopAgentRpc {
  private targets = new Map<string, (...args: unknown[]) => unknown>();
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: unknown): void }>();
  private received = new Map<string, { fingerprint: string; result: Promise<AgentRpcMessage> }>();
  private outgoing = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly send: (message: AgentRpcMessage) => Promise<void> | void) {}

  encode(value: unknown): AgentWire {
    let count = 0;
    const visit = (v: unknown, depth: number): AgentWire => {
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
        return { kind: typeof v === "function" ? "function" : "promise", value: id };
      }
      if (v instanceof Uint8Array) return { kind: "bytes", value: Buffer.from(v).toString("base64") };
      if (v instanceof Error) return { kind: "error", value: [v.name, v.message] };
      if (Array.isArray(v)) return { kind: "array", value: v.map(x => visit(x, depth + 1)) };
      if (typeof v === "object" && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null))
        return { kind: "object", value: Object.entries(v).map(([k, x]) => [k, visit(typeof x === "function" ? x.bind(v) : x, depth + 1)]) };
      throw Error("Unsupported Desktop runtime value");
    };
    return visit(value, 0);
  }

  decode(value: unknown): unknown {
    let count = 0;
    const visit = (v: unknown, depth: number): unknown => {
      if (++count > 100_000 || depth > 48) throw Error("Desktop runtime value exceeds its bound");
      if (v === null || typeof v === "string" || typeof v === "boolean" || typeof v === "number" && Number.isFinite(v)) return v;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Invalid Desktop runtime value");
      const item = v as { kind?: string; value?: unknown };
      switch (item.kind) {
        case "undefined": return undefined;
        case "bytes":
          if (typeof item.value !== "string" || item.value.length > 12 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.value)) break;
          return new Uint8Array(Buffer.from(item.value, "base64"));
        case "error": {
          if (!Array.isArray(item.value) || item.value.length !== 2 || item.value.some(x => typeof x !== "string")) break;
          const [name, message] = item.value as [string, string];
          const Type = name === "ModelAccountError" ? ModelAccountError : name === "ModelOutputError" ? ModelOutputError : name === "TransientModelError" ? TransientModelError : Error;
          const error = new Type(message); error.name = name; return error;
        }
        case "function": case "promise": {
          if (!uuid(item.value)) break;
          const target = item.value;
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
    this.pending.clear(); this.targets.clear(); this.received.clear();
  }
}
