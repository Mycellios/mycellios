import type { AgentRunModel } from "@mycellios/adapter-kit";
import type { Api, AssistantMessage, Context, Model, Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { HOST_COMPUTER_MAX_BYTES } from "./host-computer-protocol.js";
import { oneWay } from "./desktop-agent-rpc.js";

/** Room left for the call envelope under the bridge's one-frame limit. */
const CONTEXT_FRAME_BUDGET = HOST_COMPUTER_MAX_BYTES - 512 * 1024;
export const OMITTED_IMAGE_TEXT = "[An earlier image was left out to fit the connection to this computer.]";

/**
 * Each model call from a Desktop-run Mico carries its whole conversation in one bridge frame,
 * and the bridge rejects frames over HOST_COMPUTER_MAX_BYTES. Screenshots and attachments pile
 * up during a run, so replace the oldest images with a short note until the call fits. The
 * latest message keeps its images; a call that still does not fit is sent unchanged and fails
 * as before.
 */
export function fitDesktopModelContext(context: Context, budget = CONTEXT_FRAME_BUDGET): Context {
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
  let total = bytes(context);
  if (total <= budget) return context;
  const messages = [...context.messages];
  for (let index = 0; index < messages.length - 1 && total > budget; index++) {
    const message = messages[index]!;
    if (!Array.isArray(message.content) || !message.content.some(block => block?.type === "image")) continue;
    const before = bytes(message);
    const content = message.content.map(block => block?.type === "image" ? { type: "text" as const, text: OMITTED_IMAGE_TEXT } : block);
    const replaced = { ...message, content } as typeof message;
    messages[index] = replaced;
    total -= before - bytes(replaced);
  }
  return { ...context, messages };
}

type Batch = { events: unknown[]; done: boolean; result?: unknown };
/** Batches the server may send ahead of the reader; it sends one at a time, so this is ample. */
const PUSHED_BATCH_LIMIT = 64;

/**
 * The PC's sink for a pushed model stream: a one-way callback that keeps batches by number and
 * hands them out in order. A number out of range, repeated or already read is a protocol error.
 */
export function pushedBatches(signal?: AbortSignal) {
  const held = new Map<number, Batch | { failed: true }>();
  let expected = 1;
  let wake: (() => void) | undefined;
  const push = oneWay((seq: number, batch: Batch | { failed: true }) => {
    if (!Number.isSafeInteger(seq) || seq < expected || held.has(seq) || seq >= expected + PUSHED_BATCH_LIMIT ||
      !batch || typeof batch !== "object") throw Error("Invalid Desktop model batch");
    held.set(seq, batch);
    wake?.();
  });
  signal?.addEventListener("abort", () => wake?.(), { once: true });
  const next = async (): Promise<Batch> => {
    while (!held.has(expected)) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (signal?.aborted) resolve();
      });
      wake = undefined;
    }
    const batch = held.get(expected)!;
    held.delete(expected);
    expected += 1;
    if ("failed" in batch || !Array.isArray(batch.events) || typeof batch.done !== "boolean") throw Error("The account model stream failed");
    return batch;
  };
  return { push, next };
}

/** Metadata and a run-scoped stream, never a provider token or refresh credential. */
export function desktopModelCatalog(base: Models, config: AgentRunModel): Models {
  const transport = config.desktopTransport!;
  const model = transport.model as unknown as Model<Api>;
  return new Proxy(base, { get(target, key) {
    if (key === "getModel") return () => model;
    if (key === "streamSimple") return (_model: Model<Api>, context: Context, options?: ModelsSimpleStreamOptions) => {
      const output = new AssistantMessageEventStream();
      let remote: Awaited<ReturnType<typeof transport.open>> | undefined;
      // The cloud releases a stream that reached its end by itself; cancelling it
      // afterwards only cost one more relay round trip per model call.
      let completed = false;
      const abort = () => { if (!completed) void remote?.cancel().catch(() => undefined); };
      options?.signal?.addEventListener("abort", abort, { once: true });
      void (async () => {
        try {
          options?.signal?.throwIfAborted();
          const safe: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(options ?? {})) {
            if (["apiKey", "headers", "fetch", "signal", "onResponse", "onPayload"].includes(key) || typeof value === "function" || value === undefined) continue;
            safe[key] = value;
          }
          const inbox = pushedBatches(options?.signal);
          remote = await transport.open(fitDesktopModelContext(context), safe, { firstBatch: true, push: inbox.push });
          options?.signal?.throwIfAborted();
          // An older server ignores firstBatch and push: it sends no first events and answers reads.
          let first = remote.first;
          const next = remote.pushed ? inbox.next : remote.read;
          for (;;) {
            const batch = first ?? await next(); options?.signal?.throwIfAborted();
            first = undefined;
            for (const event of batch.events) output.push(event as Parameters<typeof output.push>[0]);
            if (batch.done) { completed = true; output.end(batch.result as AssistantMessage); break; }
          }
        } catch {
          const failure: AssistantMessage = { role: "assistant", api: model.api, provider: model.provider, model: model.id, content: [], timestamp: Date.now(), stopReason: options?.signal?.aborted ? "aborted" : "error", errorMessage: "The account model stream was interrupted. Check existing results before retrying.", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          output.push({ type: "error", reason: failure.stopReason as "error" | "aborted", error: failure }); output.end(failure);
        } finally {
          options?.signal?.removeEventListener("abort", abort);
          if (!completed) await remote?.cancel().catch(() => undefined);
        }
      })();
      return output;
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
}
