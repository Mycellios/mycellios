import { randomUUID } from "node:crypto";
import type { AdapterContext, AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";
import { desktopAgentFrames } from "./desktop-agent-stream.js";
import type { DesktopAgentFrame } from "./desktop-agent-host.js";
import type { HostComputerRequest } from "./host-computer-protocol.js";
import { desktopModelAccess } from "./desktop-model-access.js";
import { ComputerUpdatingError } from "./computer-errors.js";

export class DesktopAgentRuntime implements AgentRuntime {
  private active = new Map<string, AbortController>();
  constructor(private readonly options: {
    fallback: AgentRuntime;
    select(context: AdapterContext): Promise<{ available: boolean; preferred: boolean }>;
    transport(request: HostComputerRequest, context: AdapterContext): Promise<Response>;
  }) {}
  describe() { return this.options.fallback.describe(); }
  async abort(runId: string) { this.active.get(runId)?.abort(); await this.options.fallback.abort(runId); }
  async *run(request: AgentRunRequest, partial?: Partial<AdapterContext>): AsyncIterable<AgentRuntimeEvent> {
    if (!partial?.userId || !partial.spaceId || !partial.signal) throw Error("Desktop execution requires an authenticated run");
    const context = { ...partial, botId: request.botId, runId: request.runId } as AdapterContext;
    // The approval judge is a server authority, not another Desktop task waiting for
    // a runtime slot held by the very operation it is deciding whether to admit.
    if (request.usageOperationKind === "setup" && !request.tools.length || request.script) { yield* this.options.fallback.run(request, context); return; }
    const route = await this.options.select(context);
    if (!route.available) {
      if (route.preferred && (context.projectSessionId || request.resumeFromCheckpoint || request.resumeToolResult)) {
        throw Error("This task is bound to your Desktop. Reconnect the PC to resume it.");
      }
      const cloudRequest = route.preferred
        ? { ...request, instructions: `${request.instructions}\nDesktop is offline. This turn runs on the server. Use only available tools and workspaces. Explain any specific dependency on local files or devices.` }
        : request;
      yield* this.options.fallback.run(cloudRequest, context);
      return;
    }
    if (this.active.has(request.runId)) throw Error("Desktop run already active");
    const controller = new AbortController(), sessionId = randomUUID();
    const signal = AbortSignal.any([context.signal, controller.signal]);
    this.active.set(request.runId, controller);
    const owned = { ...context, signal };
    let callbackError: unknown;
    const rpc = new DesktopAgentRpc(async message => {
      const response = await this.options.transport({ method: "agentMessage", botId: request.botId, runId: request.runId, sessionId, message, ...(context.projectSessionId ? { projectSessionId: context.projectSessionId } : {}) }, owned);
      for await (const _ of desktopAgentFrames(response, signal)) { /* consume the complete acknowledgement */ }
    });
    const capture = request.onCheckpoint;
    const cleanup = new Set<() => void>();
    const trustedUsage: AgentRuntimeEvent[] = [];
    const accounting = { runId: request.runId, userId: context.userId, operationKind: request.usageOperationKind, onUsage: request.onUsage, push: (event: AgentRuntimeEvent) => trustedUsage.push(event) };
    const encodeRequest = () => rpc.encode({ ...request,
      // A native client may not self-report paid usage or bypass a reservation. Provider
      // credentials, credit observers and genuine usage stay at the cloud model boundary.
      onUsage: async () => undefined,
      model: desktopModelAccess(request.model, signal, cleanup, accounting),
      ...(request.resolveModel ? { resolveModel: async (provider: string, id: string) => desktopModelAccess(await request.resolveModel!(provider, id), signal, cleanup, accounting) } : {}),
      ...(request.resolveFallbackModel ? { resolveFallbackModel: async (provider: string, id: string, connection?: string) => desktopModelAccess(await request.resolveFallbackModel!(provider, id, connection), signal, cleanup, accounting) } : {}),
      ...(capture ? { onCheckpoint: (blob: string, id: string) => capture(() => blob, id) } : {}),
    });
    const callbacks = new Set<Promise<void>>();
    let completed = false;
    let nativeUsage = false;
    try {
      const wire = encodeRequest();
      const response = await this.options.transport({ method: "agentRun", botId: request.botId, runId: request.runId, sessionId, request: wire, ...(context.projectSessionId ? { projectSessionId: context.projectSessionId } : {}) }, owned);
      // No fallback after dispatch: a lost response can conceal real local effects.
      for await (const raw of desktopAgentFrames(response, signal)) {
        for (const usage of trustedUsage.splice(0)) yield usage;
        const frame = raw as DesktopAgentFrame;
        if (frame.kind === "rpc") {
          const task = rpc.accept(frame.message).catch(error => { callbackError = error; controller.abort(); }).finally(() => callbacks.delete(task));
          callbacks.add(task);
        } else if (frame.kind === "failure") throw rpc.decode(frame.value);
        else if (frame.kind === "event") {
          const event = rpc.decode(frame.value) as AgentRuntimeEvent;
          if (!event || typeof event.type !== "string" || completed) throw Error("Invalid Desktop agent event");
          if (event.type === "usage") {
            if (request.agentEngine && request.agentEngine !== "pi" && !nativeUsage) {
              nativeUsage = true;
              const usage = { type: "usage" as const, provider: request.model.provider, model: request.model.id, inputTokens: null, outputTokens: null, costUsd: null, usageSource: "native-cli" };
              await request.onUsage?.(usage); yield { ...usage, ...(request.onUsage ? { accounted: true } : {}) };
            }
            continue; // Untrusted host token/cost numbers are never billed.
          }
          if (event.type === "done") completed = true;
          yield event;
        } else throw Error("Invalid Desktop agent stream");
      }
      await Promise.all(callbacks);
      for (const usage of trustedUsage.splice(0)) yield usage;
      if (!completed) throw Error("Desktop agent did not finish; check existing results before retrying");
    } catch (error) { const failure = callbackError ?? error; if (failure instanceof ComputerUpdatingError) context.onComputerUpdate?.(failure.dispatched); throw failure; }
    finally { controller.abort(); for (const cancel of cleanup) cancel(); cleanup.clear(); rpc.close(); await Promise.allSettled(callbacks); this.active.delete(request.runId); }
  }
}
