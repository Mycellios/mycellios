import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventLoopDelayHistogram } from "./event-loop.js";
import { startEventLoopDelayReport } from "./event-loop.js";
import { createLogger } from "./logger.js";
import { createTestSink } from "./test-sink.js";

function fakeHistogram(maxesMs: number[]): EventLoopDelayHistogram & { resets: number } {
  let index = 0;
  const histogram = {
    resets: 0,
    get max() {
      return (maxesMs[index] ?? 0) * 1_000_000;
    },
    percentile: () => (maxesMs[index] ?? 0) * 500_000,
    enable: () => true,
    disable: () => true,
    reset() {
      histogram.resets++;
      index++;
    },
  };
  return histogram;
}

describe("startEventLoopDelayReport", () => {
  afterEach(() => vi.useRealTimers());

  it("warns only for intervals in which the event loop was blocked", () => {
    vi.useFakeTimers();
    const sink = createTestSink();
    const histogram = fakeHistogram([40, 1_800, 120]);
    let cpu = 0;
    const stop = startEventLoopDelayReport(createLogger({ service: "rakazo-api", sinks: [sink] }), {
      intervalMs: 1_000,
      thresholdMs: 500,
      histogram,
      cpuUsage: (previous) => {
        cpu += 400_000;
        return previous
          ? { user: cpu - previous.user, system: 0 }
          : { user: cpu, system: 0 };
      },
    });
    vi.advanceTimersByTime(3_000);
    stop();
    expect(histogram.resets).toBe(3);
    expect(sink.events).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "process.event_loop.blocked",
        "process.event_loop.max_ms": 1_800,
        "process.event_loop.p99_ms": 900,
        "process.cpu.interval_ms": 1_000,
      }),
    ]);
    expect(sink.events[0]?.["process.cpu.used_ms"]).toBeGreaterThan(0);
  });
});
