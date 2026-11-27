import type { Context } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
// Only the frame limit is needed; each test passes its own budget.
vi.mock("./host-computer-protocol.js", () => ({ HOST_COMPUTER_MAX_BYTES: 12 * 1024 * 1024 }));
const { OMITTED_IMAGE_TEXT, desktopModelCatalog, fitDesktopModelContext, pushedBatches } = await import("./desktop-model-stream.js");

const image = (kb: number) => ({ type: "image" as const, mimeType: "image/png", data: "A".repeat(kb * 1024) });
const text = (value: string) => ({ type: "text" as const, text: value });

function context(): Context {
  return {
    systemPrompt: "system",
    messages: [
      { role: "user", content: [text("first"), image(400)], timestamp: 1 },
      { role: "assistant", content: [text("ok")], api: "openai-completions", provider: "p", model: "m",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop", timestamp: 2 },
      { role: "toolResult", toolCallId: "t", toolName: "screenshot", content: [image(400)], isError: false, timestamp: 3 },
      { role: "user", content: [text("latest"), image(400)], timestamp: 4 },
    ],
  } as Context;
}

describe("fitDesktopModelContext", () => {
  it("returns the same context when it already fits", () => {
    const input = context();
    expect(fitDesktopModelContext(input, 10 * 1024 * 1024)).toBe(input);
  });

  it("replaces the oldest images first and keeps the latest message intact", () => {
    const input = context();
    const fitted = fitDesktopModelContext(input, 900 * 1024);
    const [first, assistant, tool, latest] = fitted.messages as Array<{ content: Array<{ type: string; text?: string }> }>;
    expect(first!.content).toEqual([text("first"), text(OMITTED_IMAGE_TEXT)]);
    expect(assistant!.content).toEqual([text("ok")]);
    expect(tool!.content[0]!.type).toBe("image");
    expect(latest!.content[1]!.type).toBe("image");
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(900 * 1024);
    // The caller's conversation is not mutated.
    expect((input.messages[0]!.content as Array<{ type: string }>)[1]!.type).toBe("image");
  });

  it("keeps the latest images even when nothing else can be removed", () => {
    const fitted = fitDesktopModelContext(context(), 1024);
    const latest = fitted.messages.at(-1)! as { content: Array<{ type: string }> };
    expect(latest.content[1]!.type).toBe("image");
    expect(fitted.messages.slice(0, -1).flatMap((m): Array<{ type: string }> => Array.isArray(m.content) ? m.content : []).some(b => b.type === "image")).toBe(false);
  });
});

describe("desktopModelCatalog", () => {
  const final = { role: "assistant", content: [{ type: "text", text: "Hi" }], stopReason: "stop" };
  const delta = { type: "text_delta", contentIndex: 0, delta: "Hi" };
  type Push = (seq: number, batch: unknown) => void;
  async function stream(open: (context: unknown, options: Record<string, unknown>, accept?: { firstBatch?: boolean; push?: Push }) => Promise<unknown>) {
    const catalog = desktopModelCatalog({} as never, { provider: "p", id: "m", desktopTransport: { model: { id: "m", api: "openai-completions", provider: "p" }, open: open as never } });
    const output = catalog.streamSimple({} as never, { messages: [] } as Context, {});
    const events: unknown[] = [];
    for await (const event of output) events.push(event);
    return { events, result: await output.result() };
  }

  it("uses the first events a current server sends with the stream, without another read", async () => {
    const read = vi.fn();
    let accepted: unknown;
    const { events, result } = await stream(async (_context, _options, accept) => {
      accepted = accept;
      return { read, cancel: async () => undefined, first: { events: [delta], done: true, result: final } };
    });
    expect(accepted).toMatchObject({ firstBatch: true, push: expect.any(Function) });
    expect(read).not.toHaveBeenCalled();
    expect(events).toEqual([delta]);
    expect(result).toEqual(final);
  });

  it("reads as before from an older server that sends no first events", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ events: [delta], done: false })
      .mockResolvedValueOnce({ events: [], done: true, result: final });
    const { events, result } = await stream(async () => ({ read, cancel: async () => undefined }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(events).toEqual([delta]);
    expect(result).toEqual(final);
  });

  it("does not cancel a stream that reached its end, saving one round trip per call", async () => {
    const cancel = vi.fn(async () => undefined);
    await stream(async () => ({ read: vi.fn(), cancel, first: { events: [delta], done: true, result: final } }));
    expect(cancel).not.toHaveBeenCalled();
  });

  it("still cancels a stream that broke off before its end", async () => {
    const cancel = vi.fn(async () => undefined);
    const read = vi.fn().mockRejectedValueOnce(Error("relay lost"));
    const { result } = await stream(async () => ({ read, cancel, first: { events: [delta], done: false } }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((result as { stopReason?: string }).stopReason).toBe("error");
  });

  it("takes batches the server pushes, in order, without reading or cancelling", async () => {
    const read = vi.fn(), cancel = vi.fn(async () => undefined);
    const later = { type: "text_delta", contentIndex: 0, delta: " there" };
    const { events, result } = await stream(async (_context, _options, accept) => {
      // The second batch overtakes the first; the PC still hands them out in order.
      setTimeout(() => { accept!.push!(2, { events: [], done: true, result: final }); accept!.push!(1, { events: [later], done: false }); }, 0);
      return { read, cancel, pushed: true, first: { events: [delta], done: false } };
    });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(events).toEqual([delta, later]);
    expect(result).toEqual(final);
  });

  it("ends with an error and releases the stream when the server reports it failed", async () => {
    const cancel = vi.fn(async () => undefined);
    const { result } = await stream(async (_context, _options, accept) => {
      setTimeout(() => accept!.push!(1, { failed: true }), 0);
      return { read: vi.fn(), cancel, pushed: true };
    });
    expect((result as { stopReason?: string }).stopReason).toBe("error");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("pushedBatches", () => {
  it("refuses a batch number that is repeated, already read or far ahead", async () => {
    const inbox = pushedBatches();
    expect(() => inbox.push(0, { events: [], done: false })).toThrow("Invalid Desktop model batch");
    inbox.push(1, { events: [], done: false });
    expect(() => inbox.push(1, { events: [], done: false })).toThrow("Invalid Desktop model batch");
    expect(() => inbox.push(1000, { events: [], done: false })).toThrow("Invalid Desktop model batch");
    await inbox.next();
    expect(() => inbox.push(1, { events: [], done: false })).toThrow("Invalid Desktop model batch");
  });

  it("stops waiting when the run is aborted", async () => {
    const controller = new AbortController();
    const inbox = pushedBatches(controller.signal);
    const waiting = inbox.next();
    controller.abort();
    await expect(waiting).rejects.toThrow();
  });
});
