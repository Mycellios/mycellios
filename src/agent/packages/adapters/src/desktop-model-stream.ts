import type { AgentRunModel } from "@rakazo/adapter-kit";
import type { Api, AssistantMessage, Context, Model, Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";

/** Metadata and a run-scoped stream, never a provider token or refresh credential. */
export function desktopModelCatalog(base: Models, config: AgentRunModel): Models {
  const transport = config.desktopTransport!;
  const model = transport.model as unknown as Model<Api>;
  return new Proxy(base, { get(target, key) {
    if (key === "getModel") return () => model;
    if (key === "streamSimple") return (_model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) => {
      const output = new AssistantMessageEventStream();
      let remote: Awaited<ReturnType<typeof transport.open>> | undefined;
      const abort = () => { void remote?.cancel().catch(() => undefined); };
      options?.signal?.addEventListener("abort", abort, { once: true });
      void (async () => {
        try {
          options?.signal?.throwIfAborted();
          const safe: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(options ?? {})) {
            if (["apiKey", "headers", "fetch", "signal", "onResponse", "onPayload"].includes(key) || typeof value === "function" || value === undefined) continue;
            safe[key] = value;
          }
          remote = await transport.open(context, safe);
          options?.signal?.throwIfAborted();
          for (;;) {
            const batch = await remote.read(); options?.signal?.throwIfAborted();
            for (const event of batch.events) output.push(event as Parameters<typeof output.push>[0]);
            if (batch.done) { output.end(batch.result as AssistantMessage); break; }
          }
        } catch {
          const failure: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(), stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: "The account model stream was interrupted. Check existing results before retrying.", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          output.push({ type: "error", reason: failure.stopReason as "error" | "aborted", error: failure }); output.end(failure);
        } finally { options?.signal?.removeEventListener("abort", abort); await remote?.cancel().catch(() => undefined); }
      })();
      return output;
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
