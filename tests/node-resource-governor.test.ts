import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { breachedLimit, createNodeResourceObserver, NodeResourceGovernor, type NodeCpuObservationClock, type NodeResourceObservation, type NodeResourceObserverOptions } from "../src/node/resource-governor.js";
import type { HardwareProbe } from "../src/worker/hardware.js";

const limits = {
  maxConcurrency: 2,
  maxCpuPercent: 80,
  maxRamMiB: 8_192,
  maxVramMiB: 6_144,
  maxDiskMiB: 32_768,
  maxTemperatureC: 85,
};

describe("NodeResourceGovernor", () => {
  it("classifies every enforced limit deterministically with thermal priority", () => {
    expect(breachedLimit(limits, observation())).toBeNull();
    expect(breachedLimit(limits, observation({ cpuPercent: 81 }))).toBe("node_cpu_limit_exceeded");
    expect(breachedLimit(limits, observation({ ramMiB: 8_193 }))).toBe("node_ram_limit_exceeded");
    expect(breachedLimit(limits, observation({ diskMiB: 32_769 }))).toBe("node_disk_limit_exceeded");
    expect(breachedLimit(limits, observation({ temperatureC: 86 }))).toBe("node_temperature_limit_exceeded");
    expect(breachedLimit(limits, observation({ cpuPercent: 99, temperatureC: 90 })))
      .toBe("node_temperature_limit_exceeded");
  });

  it("invokes bounded teardown once when a live observation breaches policy", async () => {
    const breaches: string[] = [];
    const governor = new NodeResourceGovernor(
      limits,
      async () => observation({ ramMiB: 9_000 }),
      async (code) => { breaches.push(code); },
      100,
    );
    expect(await governor.evaluate()).toBe("node_ram_limit_exceeded");
    expect(breaches).toEqual(["node_ram_limit_exceeded"]);
    governor.stop();
  });

  it("fails closed when resource observation itself becomes unavailable", async () => {
    const breaches: string[] = [];
    const governor = new NodeResourceGovernor(
      limits,
      async () => { throw new Error("probe unavailable"); },
      async (code) => { breaches.push(code); },
      100,
    );
    governor.start();
    await new Promise((resolve) => setTimeout(resolve, 140));
    expect(breaches).toEqual(["node_resource_probe_failed"]);
    governor.stop();
  });
});

describe("NodeResourceObserver CPU windows", () => {
  it("waits a real full window before an immediate 95 percent probe sample", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const wait = vi.fn(clock.options.waitMilliseconds!);
      const probe = vi.fn(async () => { clock.advance(0.1, 0.095); return hardware(); });
      const observer = createNodeResourceObserver(cache, probe, { ...clock.options, waitMilliseconds: wait });
      observer.resetCpuBaseline();
      const result = await observer();
      expect(wait).toHaveBeenCalledExactlyOnceWith(5_000);
      expect(result.cpuPercent).toBeCloseTo(0.095 / 5.1 * 100);
      expect(breachedLimit({ ...limits, maxCpuPercent: 90 }, result)).toBeNull();
      expect(probe).toHaveBeenCalledTimes(1);
    });
  });

  it("coalesces concurrent calls, preserves in-flight baseline and samples fresh after completion", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      let release = () => {};
      const wait = vi.fn((milliseconds: number) => new Promise<void>((resolve) => {
        release = () => { clock.advance(milliseconds / 1_000, 0); resolve(); };
      }));
      const probe = vi.fn(hardware);
      const observer = createNodeResourceObserver(cache, probe, { cpuClock: clock.source, waitMilliseconds: wait });
      const first = observer(), concurrent = observer();
      expect(first).toBe(concurrent);
      observer.resetCpuBaseline();
      expect(probe).not.toHaveBeenCalled();
      release();
      const [a, b] = await Promise.all([first, concurrent]);
      expect(a).toBe(b);
      expect(probe).toHaveBeenCalledTimes(1);
      const fresh = observer();
      expect(fresh).not.toBe(first);
      expect(wait).toHaveBeenCalledTimes(2);
      release();
      expect(await fresh).not.toBe(a);
      expect(probe).toHaveBeenCalledTimes(2);
    });
  });

  it("rechecks the actual clock when an injected timer resolves early", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      let early = true;
      const wait = vi.fn(async (milliseconds: number) => {
        clock.advance((early ? milliseconds - 1 : milliseconds) / 1_000, 0);
        early = false;
      });
      const probe = vi.fn(hardware);
      const observer = createNodeResourceObserver(cache, probe, { cpuClock: clock.source, waitMilliseconds: wait });
      await observer();
      expect(wait.mock.calls).toEqual([[5_000], [1]]);
      expect(clock.source.nowNanoseconds()).toBe(5_000_000_000n);
      expect(probe).toHaveBeenCalledTimes(1);
    });
  });

  it("propagates a shared probe failure and releases the failed in-flight promise", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const probe = vi.fn().mockRejectedValueOnce(new Error("fixture probe failure")).mockImplementation(hardware);
      const observer = createNodeResourceObserver(cache, probe, clock.options);
      const first = observer(), second = observer();
      expect(first).toBe(second);
      await expect(first).rejects.toThrow("fixture probe failure");
      expect((await observer()).temperatureC).toBe(60);
      expect(probe).toHaveBeenCalledTimes(2);
    });
  });

  it("excludes startup history only when the governor actually starts: 97.33 becomes 2 percent", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const charged = createNodeResourceObserver(cache, hardware, clock.options);
      const reset = createNodeResourceObserver(cache, hardware, clock.options);
      const samples: NodeResourceObservation[] = [];
      const observed = Object.assign(async () => {
        const value = await reset(); samples.push(value); return value;
      }, { resetCpuBaseline: () => reset.resetCpuBaseline() });
      const breaches = vi.fn();
      const governor = new NodeResourceGovernor({ ...limits, maxCpuPercent: 90 }, observed, breaches);
      try {
        clock.advance(10, 14.5);
        governor.start();
        clock.advance(5, 0.1);
        expect((await charged()).cpuPercent).toBeCloseTo(97.3333333333);
        expect(await governor.evaluate()).toBeNull();
        expect(samples[0]!.cpuPercent).toBeCloseTo(2);
        expect(breaches).not.toHaveBeenCalled();
      } finally { governor.stop(); }
    });
  });

  it("keeps the exact 90 percent boundary and rejects 91 after resetting", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const observer = createNodeResourceObserver(cache, hardware, clock.options);
      const breaches = vi.fn();
      const governor = new NodeResourceGovernor({ ...limits, maxCpuPercent: 90 }, observer, breaches);
      try {
        governor.start();
        clock.advance(5, 4.5);
        expect((await observer()).cpuPercent).toBe(90);
        clock.advance(5, 4.5);
        expect(await governor.evaluate()).toBeNull();
        clock.advance(5, 4.55);
        expect(await governor.evaluate()).toBe("node_cpu_limit_exceeded");
        expect(breaches).toHaveBeenCalledExactlyOnceWith("node_cpu_limit_exceeded", expect.objectContaining({ cpuPercent: 91 }));
      } finally { governor.stop(); }
    });
  });

  it("does not reset on repeated starts or after stop, preserving the active window", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const observer = createNodeResourceObserver(cache, hardware, clock.options);
      const reset = vi.spyOn(observer, "resetCpuBaseline");
      const governor = new NodeResourceGovernor(limits, observer, vi.fn());
      try {
        governor.start();
        clock.advance(4, 3.8);
        governor.start();
        clock.advance(1, 0);
        expect(reset).toHaveBeenCalledTimes(1);
        expect((await observer()).cpuPercent).toBe(76);
        governor.stop();
        governor.start();
        expect(reset).toHaveBeenCalledTimes(1);
      } finally { governor.stop(); }
    });
  });

  it("resetting CPU does not probe hardware or discard RAM, disk or temperature observations", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const probe = vi.fn(hardware);
      const observer = createNodeResourceObserver(cache, probe, clock.options);
      observer.resetCpuBaseline();
      expect(probe).not.toHaveBeenCalled();
      clock.advance(5, 0);
      const result = await observer();
      expect(result.cpuPercent).toBe(0);
      expect(result.ramMiB).toBeGreaterThan(0);
      expect(result.diskMiB).toBe(16 / (1024 * 1024));
      expect(result.temperatureC).toBe(60);
      expect(breachedLimit({ ...limits, maxTemperatureC: 59 }, result)).toBe("node_temperature_limit_exceeded");
      expect(breachedLimit({ ...limits, maxRamMiB: 0 }, result)).toBe("node_ram_limit_exceeded");
      expect(breachedLimit({ ...limits, maxDiskMiB: 0 }, result)).toBe("node_disk_limit_exceeded");
    });
  });

  it("preserves one-core CPU units and the existing clamp for multicore process time", async () => {
    await withCache(async (cache) => {
      const clock = cpuClock();
      const observer = createNodeResourceObserver(cache, hardware, clock.options);
      observer.resetCpuBaseline();
      clock.advance(5, 10);
      expect((await observer()).cpuPercent).toBe(100);
    });
  });
});

function cpuClock(): { source: NodeCpuObservationClock; options: NodeResourceObserverOptions; advance(wallSeconds: number, cpuSeconds: number): void } {
  let time = 0n, used = 0;
  const source = { readCpuUsage: () => ({ user: used, system: 0 }), nowNanoseconds: () => time };
  return {
    source,
    options: { cpuClock: source, waitMilliseconds: async (milliseconds) => { time += BigInt(Math.round(milliseconds * 1e6)); } },
    advance: (wallSeconds, cpuSeconds) => { time += BigInt(Math.round(wallSeconds * 1e9)); used += Math.round(cpuSeconds * 1e6); },
  };
}

async function hardware(): Promise<HardwareProbe> {
  return { hostname: "fixture", platform: "win32", ramMb: 16_384,
    gpus: [{ id: "gpu-0", vendor: "nvidia", model: "fixture", physicalVramMb: 4_096, temperatureC: 60 }] };
}

async function withCache(run: (cache: string) => Promise<void>): Promise<void> {
  const cache = await mkdtemp(join(tmpdir(), "mycellios-cpu-window-"));
  const payload = join(cache, "payload");
  try { await writeFile(payload, Buffer.alloc(16)); await run(cache); }
  finally { await unlink(payload); await rmdir(cache); }
}

function observation(overrides: Partial<NodeResourceObservation> = {}): NodeResourceObservation {
  return {
    cpuPercent: 20,
    ramMiB: 1_024,
    diskMiB: 5_000,
    temperatureC: 60,
    ...overrides,
  };
}
