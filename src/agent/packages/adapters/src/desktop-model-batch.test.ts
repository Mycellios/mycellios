import { describe, expect, it } from "vitest";
import type { ModelBatchState } from "./desktop-model-batch.js";
import { appendModelEvent, readModelBatch } from "./desktop-model-batch.js";

/** A buffered stream: every event is already available, as during a relay round trip. */
function buffered(events: unknown[]) {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

describe("appendModelEvent", () => {
  it("merges consecutive deltas of one block and keeps the later partial message", () => {
    const events: unknown[] = [];
    appendModelEvent(events, {
      type: "text_delta",
      contentIndex: 0,
      delta: "Hel",
      partial: { n: 1 },
    });
    appendModelEvent(events, {
      type: "text_delta",
      contentIndex: 0,
      delta: "lo",
      partial: { n: 2 },
    });
    expect(events).toEqual([
      { type: "text_delta", contentIndex: 0, delta: "Hello", partial: { n: 2 } },
    ]);
  });

  it("keeps deltas of different blocks or kinds apart", () => {
    const events: unknown[] = [];
    appendModelEvent(events, { type: "toolcall_delta", contentIndex: 1, delta: '{"a"' });
    appendModelEvent(events, { type: "toolcall_delta", contentIndex: 2, delta: '{"b"' });
    appendModelEvent(events, { type: "thinking_delta", contentIndex: 2, delta: "x" });
    appendModelEvent(events, { type: "toolcall_end", contentIndex: 2 });
    appendModelEvent(events, { type: "toolcall_end", contentIndex: 2 });
    expect(events).toHaveLength(5);
  });
});

describe("readModelBatch", () => {
  it("answers with everything buffered instead of a fixed handful of events", async () => {
    const deltas = Array.from({ length: 500 }, (_, i) => ({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: String(i % 10),
    }));
    const iterator = buffered([
      { type: "toolcall_start", contentIndex: 0 },
      ...deltas,
      { type: "toolcall_end", contentIndex: 0 },
    ]);
    const batch = await readModelBatch(iterator, {}, async () => "final", { windowMs: 1_000 });
    expect(batch).toEqual({
      events: [
        { type: "toolcall_start", contentIndex: 0 },
        { type: "toolcall_delta", contentIndex: 0, delta: deltas.map((d) => d.delta).join("") },
        { type: "toolcall_end", contentIndex: 0 },
      ],
      done: true,
      result: "final",
    });
  });

  it("holds trailing events back by size and still delivers every event once, in order", async () => {
    const big = "x".repeat(4_000);
    const source = [
      { type: "text_start", contentIndex: 0, partial: big },
      { type: "text_delta", contentIndex: 0, delta: "a", partial: big },
      { type: "text_end", contentIndex: 0, partial: big },
      { type: "toolcall_start", contentIndex: 1, partial: big },
    ];
    const iterator = buffered(source);
    const state: ModelBatchState = {};
    const seen: unknown[] = [];
    let result: unknown;
    for (let reads = 0; reads < 10 && result === undefined; reads++) {
      const batch = await readModelBatch(iterator, state, async () => "final", {
        windowMs: 1_000,
        maxBytes: 9_000,
      });
      expect(batch.events.length).toBeGreaterThan(0);
      expect(
        Buffer.byteLength(JSON.stringify(batch.events)) <= 9_000 || batch.events.length === 1,
      ).toBe(true);
      seen.push(...batch.events);
      if (batch.done) result = batch.result;
    }
    expect(seen).toEqual(source);
    expect(result).toBe("final");
  });

  it("always sends at least one event, even above the byte bound", async () => {
    const huge = { type: "toolcall_end", contentIndex: 0, partial: "y".repeat(10_000) };
    const batch = await readModelBatch(
      buffered([huge, { type: "done" }]),
      {},
      async () => "final",
      { windowMs: 1_000, maxBytes: 100 },
    );
    expect(batch.events[0]).toBe(huge);
  });

  it("answers after its window instead of waiting for a slow stream to end", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const iterator = (async function* () {
      yield { type: "text_delta", contentIndex: 0, delta: "a" };
      await gate;
      yield { type: "text_delta", contentIndex: 0, delta: "b" };
    })();
    const state: ModelBatchState = {};
    const first = await readModelBatch(iterator, state, async () => "final", { windowMs: 5 });
    expect(first).toEqual({
      events: [{ type: "text_delta", contentIndex: 0, delta: "a" }],
      done: false,
    });
    release();
    const second = await readModelBatch(iterator, state, async () => "final", { windowMs: 1_000 });
    expect(second).toEqual({
      events: [{ type: "text_delta", contentIndex: 0, delta: "b" }],
      done: true,
      result: "final",
    });
  });
});
