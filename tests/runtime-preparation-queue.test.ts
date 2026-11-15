import { describe, expect, it } from "vitest";
import { RuntimePreparationQueue } from "../src/worker/runtime-preparation-queue.js";

describe("runtime preparation ownership", () => {
  it("cancels superseded artifact work before the next preparation can start", async () => {
    const queue = new RuntimePreparationQueue();
    let active = 0, maximumActive = 0;
    let firstSignal: AbortSignal | undefined;
    const first = queue.run(async (_generation, signal) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      firstSignal = signal;
      try {
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      } finally { active -= 1; }
    });
    const rejected = expect(first).rejects.toThrow("superseded");
    await Promise.resolve();
    const second = queue.run(async (generation, signal) => {
      expect(signal.aborted).toBe(false);
      queue.assertCurrent(generation);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
    });
    await rejected;
    await second;
    expect(firstSignal?.aborted).toBe(true);
    expect(maximumActive).toBe(1);
    expect(active).toBe(0);
  });

  it("cancels the owning preparation on connection loss and rejects its stale result", async () => {
    const queue = new RuntimePreparationQueue();
    let signal: AbortSignal | undefined, generation = -1;
    const work = queue.run(async (current, currentSignal) => {
      generation = current;
      signal = currentSignal;
      await new Promise<void>((_resolve, reject) => currentSignal.addEventListener("abort", () => reject(currentSignal.reason), { once: true }));
    });
    const rejected = expect(work).rejects.toThrow("coordinator_disconnected");
    await Promise.resolve();
    queue.cancel("coordinator_disconnected");
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(() => queue.assertCurrent(generation)).toThrow("superseded");
    await expect(queue.run(async () => {})).resolves.toBeUndefined();
  });

  it("never starts a queued preparation after its owner cancels it", async () => {
    const queue = new RuntimePreparationQueue();
    let started = false;
    const work = queue.run(async () => { started = true; });
    const rejected = expect(work).rejects.toThrow("worker_shutting_down");
    queue.cancel("worker_shutting_down");
    await rejected;
    expect(started).toBe(false);
  });
});
