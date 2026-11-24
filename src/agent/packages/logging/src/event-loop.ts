import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Logger } from "./types.js";

/** The parts of Node's event-loop delay histogram this report reads. */
export interface EventLoopDelayHistogram {
  readonly max: number;
  percentile(percentile: number): number;
  enable(): boolean;
  disable(): boolean;
  reset(): void;
}

export interface EventLoopDelayReportOptions {
  /** How often the delay is checked; one warning at most per interval. */
  intervalMs?: number;
  /** Warn when the longest delay in an interval reaches this many milliseconds. */
  thresholdMs?: number;
  histogram?: EventLoopDelayHistogram;
  cpuUsage?: (previous?: NodeJS.CpuUsage) => NodeJS.CpuUsage;
}

const NS_PER_MS = 1_000_000;

/**
 * Warns when synchronous work kept the process from serving anything else. A blocked
 * event loop also holds idle database connections and makes requests wait, so this
 * tells a busy process apart from a busy database.
 */
export function startEventLoopDelayReport(
  logger: Logger,
  options: EventLoopDelayReportOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? 10_000;
  const thresholdMs = options.thresholdMs ?? 500;
  const histogram = options.histogram ?? monitorEventLoopDelay({ resolution: 20 });
  const cpuUsage = options.cpuUsage ?? ((previous) => process.cpuUsage(previous));
  histogram.enable();
  let cpuSince = cpuUsage();
  const timer = setInterval(() => {
    const maxMs = Math.round(histogram.max / NS_PER_MS);
    const cpu = cpuUsage(cpuSince);
    cpuSince = cpuUsage();
    if (maxMs >= thresholdMs) {
      logger.warn("process.event_loop.blocked", {
        "process.event_loop.max_ms": maxMs,
        "process.event_loop.p99_ms": Math.round(histogram.percentile(99) / NS_PER_MS),
        "process.cpu.interval_ms": intervalMs,
        "process.cpu.used_ms": Math.round((cpu.user + cpu.system) / 1_000),
      });
    }
    histogram.reset();
  }, intervalMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
