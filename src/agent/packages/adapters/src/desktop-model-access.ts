import type { AgentRunModel, AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import type { Context, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { reliableModelStream, resolveRuntimeModel } from "./pi-runtime.js";
import { withCloudflareAuth } from "./cloudflare-ai-gateway.js";
import { observedPiStream } from "./pi-usage.js";

/** Cloud retains keys, OAuth refresh and private connection endpoints for every provider. */
export function desktopModelAccess(config: AgentRunModel, signal: AbortSignal, cleanup: Set<() => void>, accounting: {
  runId: string; userId: string; operationKind: AgentRunRequest["usageOperationKind"];
  onUsage: AgentRunRequest["onUsage"]; push(event: AgentRuntimeEvent): void;
}): AgentRunModel {
  const target = resolveRuntimeModel(config);
  if (!target.model) throw Error("The selected account model is unavailable");
  const metadata: AgentRunModel = { provider:config.provider,id:config.id,connectionId:config.connectionId,cacheCapabilities:config.cacheCapabilities,reasoning:config.reasoning,acceptsImages:config.acceptsImages,maxImagesPerPrompt:config.maxImagesPerPrompt,maxTokens:config.maxTokens,contextWindow:config.contextWindow,thinkingLevel:config.thinkingLevel };
  const publicKeys = ["id","name","api","provider","reasoning","input","cost","contextWindow","maxTokens","compat"];
  const descriptor = Object.fromEntries(Object.entries(target.model).filter(([key])=>publicKeys.includes(key)));
  let opened = 0;
  return { ...metadata, desktopTransport: { model: { ...descriptor, baseUrl: "https://account-model.invalid" }, open: async (context, options) => {
    signal.throwIfAborted();
    if (++opened > 512) throw Error("Desktop model call limit reached");
    if (!context || typeof context !== "object" || !Array.isArray((context as Context).messages)) throw Error("Invalid model context");
    const controller = new AbortController(), ownedSignal = AbortSignal.any([signal, controller.signal]);
    const cancel = () => controller.abort(); cleanup.add(cancel);
    const safe = Object.fromEntries(Object.entries(options).filter(([key, value]) => !["apiKey", "headers", "fetch", "signal", "onResponse", "onPayload"].includes(key) && typeof value !== "function"));
    const stream = reliableModelStream(target.models, target.model!, context as Context, withCloudflareAuth(config, { ...safe, signal: ownedSignal, apiKey: target.credentials?.accessToken ?? target.apiKey } as ModelsSimpleStreamOptions), config.maxTokens, () => target.credentials?.accessToken ?? target.apiKey,
      options => observedPiStream(target.models, target.model!, context as Context, options, accounting.push, config.callObserver,
        { operationKind: accounting.operationKind ?? "answer", userId: accounting.userId, runId: accounting.runId, allowPrivateEndpoint: config.allowPrivateEndpoint },
        { recordUsage: accounting.onUsage }));
    const iterator = stream[Symbol.asyncIterator]();
    let reading = false;
    let pending: ReturnType<typeof iterator.next> | undefined;
    return { cancel: async () => { cancel(); cleanup.delete(cancel); await iterator.return?.(); }, read: async () => {
      if (reading) throw Error("Concurrent Desktop model reads are unavailable");
      reading = true;
      try {
        ownedSignal.throwIfAborted();
        const events: unknown[] = [];
        const deadline = Date.now() + 20;
        while (events.length < 16) {
          pending ??= iterator.next();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const next = events.length ? await Promise.race([pending, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())); })]).finally(() => clearTimeout(timer)) : await pending;
          if (next === null) break;
          pending = undefined;
          if (next.done) { cleanup.delete(cancel); return { events, done: true, result: await stream.result() }; }
          events.push(next.value);
          if (Date.now() >= deadline || Buffer.byteLength(JSON.stringify(events)) > 128 * 1024) break;
        }
        return { events, done: false };
      } finally { reading = false; }
    } };
  } } };
}
