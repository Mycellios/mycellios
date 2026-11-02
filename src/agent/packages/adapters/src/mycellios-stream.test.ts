import { afterEach, describe, expect, it, vi } from "vitest";
import { createMycelliosChatFetch } from "./mycellios-chat.js";
import { MycelliosStreamDeltas } from "./mycellios-stream-deltas.js";

const endpoint = "https://www.mycellios.com/v1/chat/completions";
const tool = { type: "function", function: { name: "remember", parameters: { type: "object" } } };
const frame = (content: string, finish: string | null = null) => ({
  id: "fixture-job",
  created: 1,
  model: "qwen3-test",
  choices: [{ index: 0, delta: { content }, finish_reason: finish }],
  ...(finish ? { usage: { prompt_tokens: 30, completion_tokens: 512, total_tokens: 542 } } : {}),
});
const wire = (value: unknown) =>
  `data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`;
const request = (extra = {}) => ({
  method: "POST",
  body: JSON.stringify({
    model: "qwen3-test",
    messages: [{ role: "user", content: "A synthetic task" }],
    tools: [tool],
    stream: true,
    max_tokens: 2048,
    ...extra,
  }),
});
const enc = new TextEncoder();
const response = (text: string) =>
  new Response(
    new ReadableStream({
      start(c) {
        // Split UTF-8 and SSE boundaries independently from model token boundaries.
        for (const byte of enc.encode(text)) c.enqueue(Uint8Array.of(byte));
        c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
async function translated(text: string, extra = {}) {
  return createMycelliosChatFetch(async () => response(text))(endpoint, request(extra));
}
const events = (text: string) =>
  text
    .split("\n\n")
    .filter((x) => x.startsWith("data: {"))
    .map((x) => JSON.parse(x.slice(6)));
afterEach(() => vi.useRealTimers());

describe("native Mycellios streaming", () => {
  it("bounds the total stream before parsing oversized data", async () => {
    const fetch = createMycelliosChatFetch(
      async () =>
        new Response("x".repeat(1048577), { headers: { "content-type": "text/event-stream" } }),
    );
    const r = await fetch(endpoint, request());
    await expect(r.text()).rejects.toThrow("response limit");
  });
  it("does not execute a tool envelope cut off at the output limit", async () => {
    const call = '<tool_call>{"name":"remember","arguments":{}}</tool_call>';
    const r = await translated(wire(frame(call)) + wire(frame("", "length")) + wire("[DONE]"));
    await expect(r.text()).rejects.toThrow("did not finish normally");
  });
  it("delivers a real first token before generation completes, with final usage", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = createMycelliosChatFetch(async (_input, init) => {
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
      return new Response(
        new ReadableStream({
          start(c) {
            upstream = c;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const result = await fetch(endpoint, request());
    const reader = result.body!.getReader();
    upstream.enqueue(enc.encode(wire(frame("Hola 🌍"))));
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("Hola 🌍");
    upstream.enqueue(enc.encode(wire(frame("", "length")) + wire("[DONE]")));
    upstream.close();
    let tail = "";
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      tail += new TextDecoder().decode(part.value);
    }
    expect(events(tail)[0]).toMatchObject({
      usage: { completion_tokens: 512 },
      choices: [{ finish_reason: "length" }],
    });
  });

  it.each([false, true])(
    "streams exact reasoning and escaped tool arguments, arguments-first=%s",
    async (argumentsFirst) => {
      const args = { text: 'árbol 🌳 {"quoted": "x"} \\ end', nested: [{ a: 1 }] };
      const call = argumentsFirst
        ? { arguments: args, name: "remember" }
        : { name: "remember", arguments: args };
      const text = `<think>check syntax</think>\n<tool_call>${JSON.stringify(call)}</tool_call>`;
      const source =
        [...text].map((x) => wire(frame(x))).join("") + wire(frame("", "stop")) + wire("[DONE]");
      const output = events(await (await translated(source)).text());
      expect(
        output
          .flatMap((e) => e.choices)
          .map((c) => c.delta.reasoning_content ?? "")
          .join(""),
      ).toBe("check syntax");
      const calls = output.flatMap((e) => e.choices).flatMap((c) => c.delta.tool_calls ?? []);
      expect(calls.filter((c) => c.id)).toHaveLength(1);
      expect(calls.map((c) => c.function.name ?? "").join("")).toBe("remember");
      expect(JSON.parse(calls.map((c) => c.function.arguments ?? "").join(""))).toEqual(args);
      expect(output.at(-1).choices[0].finish_reason).toBe("tool_calls");
    },
  );

  it("does not fabricate missing JSON and supports multiple complete calls", () => {
    const parser = new MycelliosStreamDeltas(["remember"], true);
    const a = '<tool_call>{"name":"remember","arguments":{"x":"a"}}</tool_call>';
    const deltas = [...(a + "\n" + a + "\n")].flatMap((x) => parser.push(x));
    const calls = deltas.flatMap((x) => x.tool_calls ?? []);
    expect(calls.filter((x) => x.id).map((x) => x.index)).toEqual([0, 1]);
    for (const i of [0, 1])
      expect(
        JSON.parse(
          calls
            .filter((x) => x.index === i)
            .map((x) => x.function.arguments ?? "")
            .join(""),
        ),
      ).toEqual({ x: "a" });
  });

  it.each([
    { name: "incomplete call", text: '<tool_call>{"name":"remember","arguments":{"x":' },
    { name: "unavailable tool", text: '<tool_call>{"name":"erase","arguments":{}}</tool_call>' },
    { name: "incomplete reasoning", text: "<think>still thinking" },
    { name: "empty output", text: "" },
    {
      name: "duplicate field",
      text: '<tool_call>{"name":"remember","name":"remember","arguments":{}}</tool_call>',
    },
  ])("fails closed on $name", async ({ text }) => {
    const r = await translated(wire(frame(text)) + wire(frame("", "stop")) + wire("[DONE]"));
    await expect(r.text()).rejects.toThrow();
  });

  it.each(["eof", "no-usage", "settlement-error", "identity-change"])(
    "rejects %s instead of completing a task",
    async (kind) => {
      const ending =
        kind === "eof"
          ? ""
          : kind === "no-usage"
            ? wire({ ...frame("", "stop"), usage: undefined }) + wire("[DONE]")
            : kind === "settlement-error"
              ? wire({ error: { message: "failed" } })
              : wire({ ...frame("x"), id: "different-job" });
      const r = await translated(wire(frame("answer")) + ending);
      await expect(r.text()).rejects.toThrow();
    },
  );

  it("cancels upstream when the consumer closes", async () => {
    let cancelled = false;
    let upstreamSignal!: AbortSignal;
    const fetch = createMycelliosChatFetch(async (_input, init) => {
      upstreamSignal = init!.signal!;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    const r = await fetch(endpoint, request());
    await r.body!.cancel("user stopped");
    await vi.waitFor(() => expect(cancelled).toBe(true));
    expect(upstreamSignal.aborted).toBe(true);
  });

  it("does not let heartbeats extend a stalled generation", async () => {
    vi.useFakeTimers();
    let c!: ReadableStreamDefaultController<Uint8Array>;
    const fetch = createMycelliosChatFetch(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              c = controller;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    const r = await fetch(endpoint, request());
    const read = r.text();
    const rejected = expect(read).rejects.toThrow("idle");
    c.enqueue(enc.encode(": ping\n\n"));
    await vi.advanceTimersByTimeAsync(180001);
    await rejected;
  });
});
