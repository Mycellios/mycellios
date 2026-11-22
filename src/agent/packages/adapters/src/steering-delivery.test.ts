import { STEERING_FRAMING_NOTE } from "@mycellios/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { steeringToolContent, watchSteeringDuringTool } from "./steering-delivery.js";

afterEach(() => vi.useRealTimers());

describe("watchSteeringDuringTool", () => {
  it("asks a running tool to yield once a message for the turn waits", async () => {
    vi.useFakeTimers();
    let waiting = false;
    const watch = watchSteeringDuringTool({ steeringPending: async () => waiting }, undefined, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(watch.signal?.aborted).toBe(false);
    waiting = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(watch.signal?.aborted).toBe(true);
    watch.stop();
  });

  it("stops checking when the tool ends and never yields on a failed check", async () => {
    vi.useFakeTimers();
    const steeringPending = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const watch = watchSteeringDuringTool({ steeringPending }, undefined, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(watch.signal?.aborted).toBe(false);
    watch.stop();
    const calls = steeringPending.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(steeringPending.mock.calls.length).toBe(calls);
  });

  it("does nothing for a run without steering", () => {
    expect(watchSteeringDuringTool({}).signal).toBeUndefined();
  });
});

describe("steeringToolContent", () => {
  it("frames each message and keeps PNG and JPEG images", () => {
    const content = steeringToolContent([
      {
        id: "s1",
        messageId: "m1",
        text: "Also check the totals.",
        images: [
          { name: "a.png", mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
          { name: "b.webp", mimeType: "image/webp", data: new Uint8Array([4]) },
        ],
      },
    ]);
    expect(content).toEqual([
      { type: "text", text: expect.stringContaining(STEERING_FRAMING_NOTE) },
      { type: "image", data: "AQID", mimeType: "image/png" },
    ]);
    expect(content[0]?.type === "text" && content[0].text.endsWith("Also check the totals.")).toBe(
      true,
    );
  });
});
