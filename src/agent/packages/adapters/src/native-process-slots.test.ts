import { describe, expect, it, vi } from "vitest";
import {
  NATIVE_PROCESS_LIMIT,
  NativeProcessSlots,
  nativeProcessWaitText,
} from "./native-process-slots.js";

const open = () => new AbortController().signal;

describe("native process slots", () => {
  it("defaults to six CLI processes per PC and refuses a bound below one", () => {
    expect(NATIVE_PROCESS_LIMIT).toBe(6);
    expect(new NativeProcessSlots().limit).toBe(6);
    for (const limit of [0, -1, 1.5, Number.NaN])
      expect(() => new NativeProcessSlots(limit)).toThrow("Invalid");
    expect(nativeProcessWaitText(6)).toBe(
      "Waiting for this PC: 6 agent engine turns are already running on it. This one starts when one finishes.",
    );
    expect(nativeProcessWaitText(1)).toContain(": 1 agent engine turn is already running");
  });

  it("admits up to the bound at once, then hands each freed slot to the turns in order", async () => {
    const slots = new NativeProcessSlots(2);
    const waits: string[] = [];
    const first = await slots.acquire(open(), () => waits.push("first"));
    const second = await slots.acquire(open(), () => waits.push("second"));
    expect(slots.state).toEqual({ running: 2, waiting: 0 });
    const order: string[] = [];
    const third = slots
      .acquire(open(), () => waits.push("third"))
      .then((release) => {
        order.push("third");
        return release;
      });
    const fourth = slots
      .acquire(open(), () => waits.push("fourth"))
      .then((release) => {
        order.push("fourth");
        return release;
      });
    expect(waits).toEqual(["third", "fourth"]);
    expect(slots.state).toEqual({ running: 2, waiting: 2 });
    second();
    second(); // A second release of the same slot frees nothing more.
    const thirdRelease = await third;
    expect(order).toEqual(["third"]);
    expect(slots.state).toEqual({ running: 2, waiting: 1 });
    first();
    const fourthRelease = await fourth;
    expect(order).toEqual(["third", "fourth"]);
    thirdRelease();
    fourthRelease();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  });

  it("lets a turn stopped while it waits leave the line without taking a slot", async () => {
    const slots = new NativeProcessSlots(1);
    const held = await slots.acquire(open());
    const stop = new AbortController();
    const stopped = slots.acquire(stop.signal);
    const next = slots.acquire(open());
    stop.abort(new Error("Stopped by the person"));
    await expect(stopped).rejects.toThrow("Stopped by the person");
    expect(slots.state).toEqual({ running: 1, waiting: 1 });
    held();
    const release = await next;
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    release();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  });

  it("never waits or takes a slot for a turn already stopped", async () => {
    const slots = new NativeProcessSlots(1);
    const stop = new AbortController();
    stop.abort();
    const onWait = vi.fn();
    await expect(slots.acquire(stop.signal, onWait)).rejects.toThrow();
    expect(onWait).not.toHaveBeenCalled();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  });
});
