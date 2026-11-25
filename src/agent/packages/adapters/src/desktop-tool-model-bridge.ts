import type { Api, AssistantMessage, Context, Model } from "@earendil-works/pi-ai";
import type { AgentRunModel, DesktopToolModelInput, DesktopToolModelTransport } from "@mycellios/adapter-kit";
import { desktopModelAccess } from "./desktop-model-access.js";
import { MAX_TOOL_MODEL_INPUT_BYTES, MAX_TOOL_MODEL_OUTPUT_TOKENS } from "./desktop-tool-model-endpoint.js";
import type { DesktopToolModelResult } from "./desktop-tool-model-endpoint.js";

function modelContext(input: DesktopToolModelInput, model: Model<Api>): Context {
  if (!input || !Array.isArray(input.messages) || input.messages.length > 128 ||
      input.messages[0]?.role !== "user" || input.messages.at(-1)?.role !== "user" ||
      (input.system !== undefined && typeof input.system !== "string") ||
      !Number.isSafeInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > MAX_TOOL_MODEL_OUTPUT_TOKENS) {
    throw new Error("Invalid desktop tool model request");
  }
  let bytes = Buffer.byteLength(input.system ?? "");
  const messages: Context["messages"] = input.messages.map((message) => {
    if (!message || (message.role !== "user" && message.role !== "assistant") || typeof message.text !== "string") {
      throw new Error("Invalid desktop tool model message");
    }
    const { role, text } = message;
    bytes += Buffer.byteLength(text);
    if (role === "user") return { role, content: text, timestamp: Date.now() };
    return {
      role, content: [{ type: "text", text }], timestamp: Date.now(),
      api: model.api, provider: model.provider, model: model.id, stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    };
  });
  if (bytes > MAX_TOOL_MODEL_INPUT_BYTES) throw new Error("Desktop tool model input is too large");
  return { systemPrompt: input.system, messages };
}

/** Server-side only. The caller supplies this run's owner-approved budget and metered model. */
export function desktopToolModelAccess(
  model: AgentRunModel,
  signal: AbortSignal,
  cleanup: Set<() => void>,
  accounting: Parameters<typeof desktopModelAccess>[3],
): DesktopToolModelTransport {
  if (!model.callObserver || model.oauth || model.desktopTransport) {
    throw new Error("Desktop tool model access requires an eligible metered model");
  }
  const transport = desktopModelAccess(model, signal, cleanup, accounting, "local-tool").desktopTransport!;
  const descriptor = transport.model as unknown as Model<Api>;
  return {
    modelId: model.id,
    async open(input) {
      signal.throwIfAborted();
      return transport.open(modelContext(input, descriptor), { maxTokens: input.maxTokens });
    },
  };
}

/** Desktop receives the scoped text inference callback alone. */
export function desktopToolModelCompletion(transport: DesktopToolModelTransport) {
  return async (
    input: DesktopToolModelInput,
    signal: AbortSignal,
    onText?: (text: string) => Promise<void>,
  ): Promise<DesktopToolModelResult> => {
    signal.throwIfAborted();
    const remote = await transport.open(input);
    let cancelled = false;
    const cancel = () => {
      if (cancelled) return;
      cancelled = true;
      void remote.cancel().catch(() => undefined);
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      let batch = remote.first ?? await remote.read();
      for (;;) {
        signal.throwIfAborted();
        if (onText) {
          for (const event of batch.events) {
            const delta = event as { type?: unknown; delta?: unknown } | null;
            if (delta?.type === "text_delta" && typeof delta.delta === "string") await onText(delta.delta);
          }
        }
        if (batch.done) break;
        batch = await remote.read();
      }
      signal.throwIfAborted();
      const message = batch.result as AssistantMessage | undefined;
      if (message?.stopReason !== "stop" && message?.stopReason !== "length") {
        throw new Error("The account model call did not complete");
      }
      return {
        text: message.content.map((block) => block.type === "text" ? block.text : "").join(""),
        stop: message.stopReason,
        inputTokens: message.usage.input + message.usage.cacheRead + message.usage.cacheWrite,
        outputTokens: message.usage.output,
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      // A close acknowledgement is housekeeping. A finished receipt stays finished.
      cancel();
    }
  };
}
