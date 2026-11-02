import { EventSourceParserStream } from "eventsource-parser/stream";
import { z } from "zod";
import { MODEL_STREAM_IDLE_TIMEOUT_MS } from "./pi-runtime-limits.js";
import { withAbort } from "./web-ssrf.js";
import { MycelliosStreamDeltas } from "./mycellios-stream-deltas.js";

const MAX_BYTES = 1_048_576;
const chunkSchema = z.object({
  id: z.string().min(1),
  created: z.number().finite(),
  model: z.string(),
  choices: z
    .array(
      z.object({
        index: z.literal(0),
        delta: z.object({ content: z.string().optional(), role: z.string().optional() }),
        finish_reason: z.string().nullable(),
      }),
    )
    .max(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative(),
      completion_tokens: z.number().int().nonnegative(),
      total_tokens: z.number().int().nonnegative(),
    })
    .passthrough()
    .optional(),
});

export function mycelliosStreamResponse(
  response: Response,
  options: {
    signal: AbortSignal;
    abort: (reason: unknown) => void;
    model: string;
    names: string[];
    parallel: boolean;
    validate: (text: string) => { toolCalls: number };
  },
): Response {
  if (!response.body) throw new Error("Mycellios returned no stream body.");
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const reader = response.body
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(value, controller) {
          bytes += value.byteLength;
          if (bytes > MAX_BYTES)
            throw new Error("Mycellios completion exceeded the response limit.");
          controller.enqueue(value);
        },
      }),
    )
    .pipeThrough(
      new TransformStream<Uint8Array, string>({
        transform(value, controller) {
          controller.enqueue(decoder.decode(value, { stream: true }));
        },
        flush(controller) {
          const tail = decoder.decode();
          if (tail) controller.enqueue(tail);
        },
      }),
    )
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: MAX_BYTES, onError: "terminate" }))
    .getReader();
  const encoder = new TextEncoder();
  const deltas = new MycelliosStreamDeltas(options.names, options.parallel);
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => options.abort(new Error("Mycellios stream became idle.")),
      MODEL_STREAM_IDLE_TIMEOUT_MS,
    );
    timer.unref?.();
  };
  arm();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let base: { id: string; object: string; created: number; model: string } | undefined;
      let terminal: z.infer<typeof chunkSchema> | undefined;
      let done = false;
      const send = (frame: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
      try {
        while (true) {
          const part = await withAbort(reader.read(), options.signal);
          if (part.done) break;
          if (part.value.data === "[DONE]") {
            if (!base || !terminal?.usage)
              throw new Error("Mycellios stream ended without final usage.");
            const checked = options.validate(deltas.text);
            if (checked.toolCalls && terminal.choices[0]?.finish_reason !== "stop")
              throw new Error("Mycellios tool generation did not finish normally.");
            send({
              ...base,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: checked.toolCalls
                    ? "tool_calls"
                    : terminal.choices[0]?.finish_reason,
                },
              ],
              usage: terminal.usage,
            });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            done = true;
            break;
          }
          const raw: unknown = JSON.parse(part.value.data);
          if (typeof raw === "object" && raw !== null && "error" in raw)
            throw new Error("Mycellios reported a failed generation or settlement.");
          const frame = chunkSchema.parse(raw);
          if (frame.model !== options.model || (base && frame.id !== base.id))
            throw new Error("Mycellios stream identity changed.");
          if (!base)
            base = {
              id: frame.id,
              object: "chat.completion.chunk",
              created: frame.created,
              model: frame.model,
            };
          const choice = frame.choices[0];
          if (terminal && (choice?.delta.content || choice?.finish_reason))
            throw new Error("Mycellios sent data after its terminal frame.");
          const text = choice?.delta.content;
          if (text) {
            arm();
            for (const delta of deltas.push(text))
              send({ ...base, choices: [{ index: 0, delta, finish_reason: null }] });
          }
          if (choice?.finish_reason) terminal = frame;
        }
        if (!done) throw new Error("Mycellios stream was interrupted before completion.");
        controller.close();
      } catch (error) {
        options.abort(error);
        controller.error(error);
      } finally {
        clearTimeout(timer);
        void reader.cancel().catch(() => undefined);
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      options.abort(reason);
      return reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      ...(response.headers.get("x-network-request-id")
        ? { "x-network-request-id": response.headers.get("x-network-request-id")! }
        : {}),
    },
  });
}
