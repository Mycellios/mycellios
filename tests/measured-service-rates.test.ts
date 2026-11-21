import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ChatCompletionRequest, JobPayload, WorkerEnvelope } from "../src/contracts/types.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { MeasuredServiceRates, predictedServiceMs } from "../src/scheduler/measured-service-rates.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

function observe(rates: MeasuredServiceRates, ratios: number[], workerId = "w", deploymentId = "d"): void {
  for (const ratio of ratios) rates.record({ workerId, deploymentId, observedMs: 1_000 * ratio, predictedMs: 1_000 });
}

describe("measured service rates (specs/node-owner-privacy D2, phase 2b)", () => {
  it("trusts claims until three recent jobs were measured, then uses the median slowdown", () => {
    const rates = new MeasuredServiceRates();
    observe(rates, [10, 10]);
    expect(rates.factor("w", "d")).toBe(1);
    observe(rates, [8]);
    expect(rates.factor("w", "d")).toBe(10);
    observe(rates, [1, 1, 1]);
    expect(rates.factor("w", "d")).toBe(1);
  });

  it("never rewards claiming less than delivered and caps the slowdown", () => {
    const rates = new MeasuredServiceRates();
    observe(rates, [0.2, 0.3, 0.1], "modest");
    expect(rates.factor("modest", "d")).toBe(1);
    observe(rates, [500, 500, 500], "liar");
    expect(rates.factor("liar", "d")).toBe(20);
  });

  it("is robust to one slow job and forgets old samples", () => {
    let now = 0;
    const rates = new MeasuredServiceRates(() => now);
    observe(rates, [1, 30, 1.1]);
    expect(rates.factor("w", "d")).toBe(1.1);
    now = 6 * 60 * 60_000 + 1;
    expect(rates.factor("w", "d")).toBe(1);
  });

  it("ignores impossible observations", () => {
    const rates = new MeasuredServiceRates();
    for (const observation of [
      { observedMs: -1, predictedMs: 10 }, { observedMs: 10, predictedMs: 0 }, { observedMs: Number.NaN, predictedMs: 10 },
    ]) rates.record({ workerId: "w", deploymentId: "d", ...observation });
    observe(rates, [5, 5]);
    expect(rates.factor("w", "d")).toBe(1);
  });

  it("predicts from the claims the node reported", () => {
    expect(predictedServiceMs({ ttftMs: 500, tokensPerSecond: 50 }, 100, true)).toBe(2_500);
    expect(predictedServiceMs({ ttftMs: 500, tokensPerSecond: 0 }, 100, false)).toBe(500);
  });
});

describe("scheduler with measured rates", () => {
  const request: ChatCompletionRequest = { model: "distributed-small", messages: [{ role: "user", content: "hi" }], max_tokens: 128 };

  it("stops sending work to a node once it measured slower than it claims", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const boaster = await addWorker(store, { id: "boaster", tokensPerSecond: 400, ttftMs: 50 });
      const honest = await addWorker(store, { id: "honest", tokensPerSecond: 40, ttftMs: 500 });
      const scheduler = new Scheduler(store);
      expect((await scheduler.selectRoute(request, "s1"))!.stages[0]!.workerId).toBe(boaster.id);
      const deploymentId = boaster.capabilities.deployments[0]!.deploymentId;
      observe(scheduler.serviceRates, [20, 20, 20], boaster.id, deploymentId);
      for (let round = 0; round < 20; round += 1) {
        expect((await scheduler.selectRoute(request, `s-${round}`))!.stages[0]!.workerId).toBe(honest.id);
      }
    } finally {
      await database.close();
    }
  });

  it("never makes the only node ineligible because it measured slow", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const only = await addWorker(store, { id: "only", tokensPerSecond: 10, ttftMs: 1_000 });
      const scheduler = new Scheduler(store);
      observe(scheduler.serviceRates, [20, 20, 20], only.id, only.capabilities.deployments[0]!.deploymentId);
      const slowRequest = { ...request, max_tokens: 1_000, deadline_ms: 120_000 };
      expect((await scheduler.selectRoute(slowRequest, "s"))!.stages[0]!.workerId).toBe(only.id);
    } finally {
      await database.close();
    }
  });
});

describe("mesh service measurement", () => {
  class Hub extends EventEmitter {
    readonly connected = new Set<string>();
    readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];
    connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
    isConnected(workerId: string): boolean { return this.connected.has(workerId); }
    send(workerId: string, type: string, payload: unknown): boolean {
      this.sent.push({ workerId, type, payload });
      return this.isConnected(workerId);
    }
    message(envelope: WorkerEnvelope): void { this.emit("envelope", envelope); }
  }

  it("records the real duration against the node's own prediction, capping output by the bytes received", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const hub = new Hub();
      const worker = await addWorker(store, { id: "measured", tokensPerSecond: 20, ttftMs: 100 });
      hub.connected.add(worker.id);
      const scheduler = new Scheduler(store);
      const record = vi.spyOn(scheduler.serviceRates, "record");
      const service = await MeshService.create(store, scheduler, hub as unknown as WorkerHub, 30_000);
      const handle = await service.submit({ ...request(), max_tokens: 64 });
      const offer = hub.sent.find((message) => message.type === "lease.offer")!.payload as JobPayload;
      hub.message({ v: 1, type: "lease.accept", workerId: worker.id, payload: { jobId: handle.jobId, leaseId: offer.leaseId } });
      hub.message({ v: 1, type: "task.token", workerId: worker.id, payload: { jobId: handle.jobId, leaseId: offer.leaseId, index: 0, text: "x".repeat(40) } });
      hub.message({ v: 1, type: "task.complete", workerId: worker.id, payload: {
        jobId: handle.jobId, leaseId: offer.leaseId, text: "x".repeat(40), finishReason: "stop",
        // 30 tokens for 40 bytes passes validation; the measurement caps it at 20.
        metrics: { inputTokens: 2, outputTokens: 30, ttftMs: 1, activeMs: 2 },
      } });
      await service.drainEvents();
      expect(record).toHaveBeenCalledTimes(1);
      const observation = record.mock.calls[0]![0];
      expect(observation).toMatchObject({ workerId: worker.id, deploymentId: worker.capabilities.deployments[0]!.deploymentId });
      expect(observation.predictedMs).toBe(100 + (20 / 20) * 1_000);
      expect(observation.observedMs).toBeGreaterThanOrEqual(0);
    } finally {
      await database.close();
    }
  });

  function request(): ChatCompletionRequest {
    return { model: "distributed-small", messages: [{ role: "user", content: "hello" }] };
  }
});
