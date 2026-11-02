import { afterEach, describe, expect, it, vi } from "vitest";
import { HeartbeatObservation } from "../src/worker/heartbeat-observation.js";

afterEach(() => vi.useRealTimers());

describe("heartbeat observations", () => {
  it("bounds a hung probe and keeps one underlying call across later heartbeats", async () => {
    vi.useFakeTimers();
    const sample = new HeartbeatObservation<{ ready: boolean }>();
    let complete!: (value: { ready: boolean }) => void;
    const read = vi.fn(() => new Promise<{ ready: boolean }>((resolve) => { complete = resolve; }));
    const first = sample.read(read);
    const overlapping = sample.read(read);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toBeNull();
    expect(await overlapping).toBeNull();
    const later = sample.read(read);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await later).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    complete({ ready: true });
    await vi.advanceTimersByTimeAsync(0);
    const fresh = vi.fn(async () => ({ ready: false }));
    expect(await sample.read(fresh)).toEqual({ ready: false });
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains synchronous and asynchronous failures and recovers on fresh evidence", async () => {
    const sample = new HeartbeatObservation<{ ready: boolean }>();
    expect(await sample.read(() => { throw new Error("probe failed"); })).toBeNull();
    expect(await sample.read(async () => { throw new Error("probe rejected"); })).toBeNull();
    expect(await sample.read(async () => ({ ready: true }))).toEqual({ ready: true });
  });
});
