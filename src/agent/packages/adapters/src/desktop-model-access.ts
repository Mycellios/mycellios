import type { AgentRunModel, AgentRunRequest, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import type { Context, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { reliableModelStream, resolveRuntimeModel } from "./pi-runtime.js";
import { withCloudflareAuth } from "./cloudflare-ai-gateway.js";
import { maximumModelCallCost, observedPiStream } from "./pi-usage.js";
import { readModelBatch } from "./desktop-model-batch.js";
import type { ModelBatchState } from "./desktop-model-batch.js";

/** Cloud retains keys, OAuth refresh and private connection endpoints for every provider. */
export function desktopModelAccess(config: AgentRunModel, signal: AbortSignal, cleanup: Set<() => void>, accounting: {
  runId: string; userId: string; operationKind: AgentRunRequest["usageOperationKind"];
  onUsage: AgentRunRequest["onUsage"]; push(event: AgentRuntimeEvent): void;
}, mode?: "local-tool"): AgentRunModel {
  const target = resolveRuntimeModel(config);
  const model = target.model;
  if (!model) throw Error("The selected account model is unavailable");
  const metadata: AgentRunModel = { provider:config.provider,id:config.id,connectionId:config.connectionId,cacheCapabilities:config.cacheCapabilities,reasoning:config.reasoning,acceptsImages:config.acceptsImages,maxImagesPerPrompt:config.maxImagesPerPrompt,maxTokens:config.maxTokens,contextWindow:config.contextWindow,thinkingLevel:config.thinkingLevel };
  const publicKeys = ["id","name","api","provider","reasoning","input","cost","contextWindow","maxTokens","compat"];
  const descriptor = Object.fromEntries(Object.entries(model).filter(([key])=>publicKeys.includes(key)));
  // Tool calls hold for a full context window until a tighter bound is qualified.
  const ordinaryObserver = config.callObserver;
  const observer = mode && ordinaryObserver ? {
    ...ordinaryObserver,
    beforeCall: (call: Parameters<typeof ordinaryObserver.beforeCall>[0]) =>
      ordinaryObserver.beforeCall({
        ...call,
        maxCostUsd: maximumModelCallCost(model.cost, model.contextWindow,
          call.maxOutputTokens, call.cacheWriteRetention),
      }),
  } : ordinaryObserver;
  let opened = 0;
  return { ...metadata, desktopTransport: { model: { ...descriptor, baseUrl: "https://account-model.invalid" }, open: async (context, options, accept) => {
    signal.throwIfAborted();
    if (++opened > 512) throw Error("Desktop model call limit reached");
    if (!context || typeof context !== "object" || !Array.isArray((context as Context).messages)) throw Error("Invalid model context");
    const controller = new AbortController(), ownedSignal = AbortSignal.any([signal, controller.signal]);
    const cancel = () => controller.abort(); cleanup.add(cancel);
    const safe = Object.fromEntries(Object.entries(options).filter(([key, value]) => !["apiKey", "headers", "fetch", "signal", "onResponse", "onPayload"].includes(key) && typeof value !== "function"));
    if (mode) {
      safe.maxRetries = 0;
      delete safe.cacheRetention;
    }
    const stream = reliableModelStream(target.models, model, context as Context, withCloudflareAuth(config, { ...safe, signal: ownedSignal, apiKey: target.credentials?.accessToken ?? target.apiKey } as ModelsSimpleStreamOptions), config.maxTokens, () => target.credentials?.accessToken ?? target.apiKey,
      options => observedPiStream(target.models, model, context as Context, options, accounting.push, observer,
        { operationKind: accounting.operationKind ?? "answer", userId: accounting.userId, runId: accounting.runId, allowPrivateEndpoint: config.allowPrivateEndpoint },
        { recordUsage: accounting.onUsage }));
    const iterator = stream[Symbol.asyncIterator]();
    let reading = false;
    const state: ModelBatchState = {};
    const stop = async () => { cancel(); cleanup.delete(cancel); await iterator.return?.(); };
    const read = async () => {
      if (reading) throw Error("Concurrent Desktop model reads are unavailable");
      reading = true;
      try {
        ownedSignal.throwIfAborted();
        const batch = await readModelBatch(iterator, state, () => stream.result());
        if (batch.done) cleanup.delete(cancel);
        return batch;
      } finally { reading = false; }
    };
    // A Desktop that asks for it gets the first events with the stream, one round trip sooner.
    if (accept?.firstBatch !== true) return { cancel: stop, read };
    try {
      return { cancel: stop, read, first: await read() };
    } catch (error) {
      await stop().catch(() => undefined);
      throw error;
    }
  } } };
}
