import type { AdapterContext, ComputerRef } from "@mycellios/adapter-kit";
import { describe, expect, it } from "vitest";
import { HostComputerSandbox } from "./host-computer-sandbox.js";

const computer = { botId: "bot-1" } as ComputerRef;
const context = () =>
  ({
    userId: "user-1",
    spaceId: "space-1",
    botId: "bot-1",
    signal: new AbortController().signal,
  }) as AdapterContext;

/** A relay response that sends `frames`, then closes only after `closeAfterMs`, as the relay waits for the PC's final chunk. */
function relayResponse(frames: unknown[], closeAfterMs: number) {
  const seen = { cancelled: false, closed: false };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames)
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
      setTimeout(() => {
        if (seen.cancelled) return;
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ done: true })}\n`));
        controller.close();
        seen.closed = true;
      }, closeAfterMs);
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return {
    seen,
    response: new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
  };
}

describe("HostComputerSandbox command streams", () => {
  it("reads a command's stream to its end when the caller stops at the exit", async () => {
    const relay = relayResponse(
      [{ value: { type: "stdout", data: "hello\n" } }, { value: { type: "exit", code: 0 } }],
      50,
    );
    const sandbox = new HostComputerSandbox("", "", async () => relay.response);
    const events: unknown[] = [];
    for await (const event of sandbox.execute(computer, { argv: ["echo", "hello"] }, context())) {
      events.push(event);
      if (event.type === "exit") break;
    }
    expect(events).toEqual([
      { type: "stdout", data: "hello\n" },
      { type: "exit", code: 0 },
    ]);
    expect(relay.seen).toEqual({ cancelled: false, closed: true });
  });

  it("still cancels a command the caller abandons before its exit", async () => {
    const relay = relayResponse([{ value: { type: "stdout", data: "hello\n" } }], 50);
    const sandbox = new HostComputerSandbox("", "", async () => relay.response);
    for await (const event of sandbox.execute(computer, { argv: ["sleep", "60"] }, context())) {
      expect(event).toEqual({ type: "stdout", data: "hello\n" });
      break;
    }
    expect(relay.seen.cancelled).toBe(true);
  });
});
