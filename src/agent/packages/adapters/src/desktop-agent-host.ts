import type { AdapterContext, AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import { getLogger } from "@rakazo/logging";
import { NativeEventQueue } from "./native-agent-process.js";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";
import type { AgentRpcMessage, AgentWire } from "./desktop-agent-rpc.js";

export type DesktopAgentFrame = { kind: "rpc"; message: AgentRpcMessage } | { kind: "event"; value: AgentWire } | { kind: "failure"; value: AgentWire };
type Session = { botId: string; runId: string; projectSessionId?: string; rpc: DesktopAgentRpc; fail(error: unknown): void };

/** The native host owns the model loop; durable account effects remain scoped callbacks. */
export class DesktopAgentHost {
  private sessions = new Map<string, Session>();
  constructor(private readonly runtime: AgentRuntime) {}

  async *run(sessionId: string, wire: unknown, botId: string, runId: string, context: AdapterContext): AsyncIterable<DesktopAgentFrame> {
    if (this.sessions.has(sessionId) || this.sessions.size >= 8) throw Error("Desktop agent session unavailable");
    const queue = new NativeEventQueue<DesktopAgentFrame>();
    let queuedBytes = 0;
    const sizes = new WeakMap<DesktopAgentFrame, number>();
    const push = (frame: DesktopAgentFrame) => {
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      if (bytes > 12 * 1024 * 1024 || queuedBytes + bytes > 16 * 1024 * 1024) { queue.fail(Error("Desktop agent event buffer exceeded its bound")); throw Error("Desktop agent event buffer exceeded its bound"); }
      sizes.set(frame, bytes); queuedBytes += bytes; queue.push(frame);
    };
    const controller = new AbortController();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    const rpc = new DesktopAgentRpc(message => { push({ kind: "rpc", message }); });
    const request = rpc.decode(wire) as AgentRunRequest;
    if (!request || request.botId !== botId || request.runId !== runId || typeof request.threadId !== "string" ||
        typeof request.prompt !== "string" || typeof request.instructions !== "string" || !Array.isArray(request.history) ||
        !Array.isArray(request.tools) || !request.model || typeof request.model.provider !== "string" || typeof request.model.id !== "string") {
      rpc.close(); throw Error("Invalid Desktop agent request");
    }
    // onCheckpoint's capture is synchronous. Serialize it at the producer, preserving the exact
    // per-call transcript, then reconstruct that cheap capture on the durable worker.
    if (request.onCheckpoint) {
      const checkpoint = request.onCheckpoint as unknown as (blob: string, id: string) => Promise<void>;
      request.onCheckpoint = (capture, id) => checkpoint(capture(), id);
    }
    const fail = (error: unknown) => { queue.fail(error instanceof Error ? error : Error("Desktop agent failed")); controller.abort(); };
    this.sessions.set(sessionId, { botId, runId, projectSessionId: context.projectSessionId, rpc, fail });
    const abort = () => { controller.abort(); queue.end(); void this.runtime.abort(runId); };
    signal.addEventListener("abort", abort, { once: true });
    const work = (async () => {
      try {
        for await (const event of this.runtime.run(request, { ...context, signal })) {
          if (signal.aborted) break;
          push({ kind: "event", value: rpc.encode(event) });
        }
        // Void observers can still have callbacks in flight after the engine returns.
        // Keep the session addressable until their replies arrive.
        if (!signal.aborted) {
          try {
            await rpc.drainOutgoing(AbortSignal.any([signal, AbortSignal.timeout(30_000)]));
          } catch {
            if (!signal.aborted) throw Error("Desktop execution interrupted; check existing results before retrying");
          }
        }
      }
      catch (error) { if (!signal.aborted) { try { push({ kind: "failure", value: rpc.encode(error instanceof Error ? error : Error("Desktop agent failed")) }); } catch { queue.fail(Error("Desktop agent buffer unavailable")); } } }
      finally { queue.end(); }
    })();
    try { if (signal.aborted) abort(); for await (const frame of queue) { queuedBytes -= sizes.get(frame) ?? 0; yield frame; } }
    finally { signal.removeEventListener("abort", abort); controller.abort(); rpc.close(); await this.runtime.abort(runId); await work; this.sessions.delete(sessionId); }
  }

  hasSession(sessionId: string, botId: string, runId: string, projectSessionId?: string) {
    const session = this.sessions.get(sessionId);
    return !!session && session.botId === botId && session.runId === runId && session.projectSessionId === projectSessionId;
  }

  async message(sessionId: string, message: unknown, botId: string, runId: string, projectSessionId?: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.botId !== botId || session.runId !== runId || session.projectSessionId !== projectSessionId) throw Error("Desktop agent session changed");
    const result = !!message && typeof message === "object" && (message as { kind?: unknown }).kind === "result";
    if (result) {
      const started = Date.now();
      await session.rpc.accept(message);
      getLogger().info("desktop.agent.result_applied", { "run.id": runId, "desktop.elapsed_ms": Date.now() - started });
      return;
    }
    // Calls stay fire-and-forget: awaiting a nested callback would hold a second native execution slot.
    void session.rpc.accept(message).catch(session.fail);
  }
}
