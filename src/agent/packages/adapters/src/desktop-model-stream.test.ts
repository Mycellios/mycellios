import type { Context } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
// Only the frame limit is needed; each test passes its own budget.
vi.mock("./host-computer-protocol.js", () => ({ HOST_COMPUTER_MAX_BYTES: 12 * 1024 * 1024 }));
const { OMITTED_IMAGE_TEXT, desktopModelCatalog, fitDesktopModelContext } = await import("./desktop-model-stream.js");

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
  async function stream(open: (context: unknown, options: Record<string, unknown>, accept?: { firstBatch?: boolean }) => Promise<unknown>) {
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
    expect(accepted).toEqual({ firstBatch: true });
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
});
