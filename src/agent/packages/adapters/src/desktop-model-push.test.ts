import { describe, expect, it, vi } from "vitest";
import { pushModelBatches } from "./desktop-model-access.js";

const batch = (n: number) => ({ events: [{ type: "text_delta", contentIndex: 0, delta: String(n) }], done: false as const });

describe("pushModelBatches", () => {
  it("sends every batch in order, one at a time, until the stream is done", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(batch(1))
      .mockResolvedValueOnce(batch(2))
      .mockResolvedValueOnce({ events: [], done: true, result: { role: "assistant" } });
    let inFlight = 0, most = 0;
    const sent: number[] = [];
    const push = vi.fn(async (seq: number) => {
      inFlight += 1; most = Math.max(most, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      sent.push(seq); inFlight -= 1;
    });
    const stop = vi.fn(async () => undefined);
    await pushModelBatches(read, push, stop);
    expect(sent).toEqual([1, 2, 3]);
    expect(most).toBe(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("releases a broken stream and tells the PC once", async () => {
    const read = vi.fn().mockResolvedValueOnce(batch(1)).mockRejectedValueOnce(Error("provider closed"));
    const push = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    await pushModelBatches(read, push, stop);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(push.mock.calls).toEqual([[1, batch(1)], [2, { failed: true }]]);
  });

  it("stops reading when the PC can no longer be reached", async () => {
    const read = vi.fn().mockResolvedValue(batch(1));
    const push = vi.fn(async () => { throw Error("Desktop runtime disconnected"); });
    const stop = vi.fn(async () => undefined);
    await pushModelBatches(read, push, stop);
    expect(read).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
