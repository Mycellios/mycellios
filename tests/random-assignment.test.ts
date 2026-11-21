import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  decideExecutionRoute,
  type ExecutionRouteCandidate,
} from "../src/distribution/execution-route-policy.js";
import type { ChatCompletionRequest, JobPayload } from "../src/contracts/types.js";
import { LeaseRejectionMonitor } from "../src/coordinator/lease-rejection-monitor.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

type Route = { id: string };

class RecordingHub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  send(workerId: string, type: string, payload: unknown): boolean {
    this.sent.push({ workerId, type, payload });
    return this.isConnected(workerId);
  }
}

function candidate(id: string, score: number, serviceMs?: number): ExecutionRouteCandidate<Route> {
  return {
    id,
    kind: "remote-replica",
    route: { id },
    score,
    ...(serviceMs === undefined ? {} : { serviceMs }),
    nodeCount: 1,
    meetsSlo: true,
    eligible: true,
    rejectionReasons: [],
  };
}

describe("near-best band (specs/node-owner-privacy D2)", () => {
  it("spreads offers between equivalent candidates instead of always taking the lowest id", () => {
    const counts = new Map<string, number>();
    let next = 0;
    for (let round = 0; round < 100; round += 1) {
      const decision = decideExecutionRoute({
        candidates: [candidate("a", 0.04, 1_000), candidate("b", 0.04, 1_000), candidate("slow", 0.2, 9_000)],
        serviceBand: 0.1,
        randomIndex: (size) => (next++) % size,
      });
      const chosen = decision.selected!.candidateId;
      counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
      expect(decision.recommendation!.candidateId).toBe("a");
    }
    expect(counts.get("a")).toBe(50);
    expect(counts.get("b")).toBe(50);
    expect(counts.has("slow")).toBe(false);
  });

  it("keeps a clearly faster candidate even when the scores are close", () => {
    const decision = decideExecutionRoute({
      candidates: [candidate("fast", 0.0272, 1_280), candidate("slower", 0.0283, 1_600)],
      serviceBand: 0.1,
      randomIndex: () => 1,
    });
    expect(decision.selected!.candidateId).toBe("fast");
  });

  it("keeps a healthy session affinity", () => {
    const decision = decideExecutionRoute({
      candidates: [candidate("a", 0.04, 1_000), candidate("b", 0.04, 1_000)],
      affinityCandidateId: "b",
      maxAffinityScorePenalty: Number.MAX_SAFE_INTEGER,
      serviceBand: 0.1,
      randomIndex: () => 0,
    });
    expect(decision.selected).toMatchObject({ candidateId: "b", reason: "selected_kv_affinity" });
  });

  it("lists every other eligible candidate as a fallback", () => {
    const decision = decideExecutionRoute({
      candidates: [candidate("a", 0.04, 1_000), candidate("b", 0.04, 1_000), candidate("c", 0.3, 5_000)],
      serviceBand: 0.1,
      randomIndex: () => 1,
    });
    expect(decision.selected!.candidateId).toBe("b");
    expect(decision.fallbacks.map((fallback) => fallback.candidateId)).toEqual(["a", "c"]);
  });

  it("refuses a band without randomness or an index outside it", () => {
    expect(() => decideExecutionRoute({ candidates: [candidate("a", 0.1)], serviceBand: 0.1 })).toThrow(RangeError);
    expect(() => decideExecutionRoute({
      candidates: [candidate("a", 0.1), candidate("b", 0.1)],
      serviceBand: 0.1,
      randomIndex: () => 2,
    })).toThrow(RangeError);
    expect(() => decideExecutionRoute({ candidates: [candidate("a", 0.1)], serviceBand: -1 })).toThrow(RangeError);
  });
});

describe("scheduler assignment", () => {
  const request: ChatCompletionRequest = {
    model: "distributed-small",
    messages: [{ role: "user", content: "hello" }],
    max_tokens: 128,
  };

  it("gives equivalent workers a share of the work with the default randomness", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const workers = await Promise.all(["one", "two", "three"].map((id) => addWorker(store, { id, tokensPerSecond: 40 })));
      const scheduler = new Scheduler(store);
      const chosen = new Set<string>();
      for (let round = 0; round < 60; round += 1) {
        const route = await scheduler.selectRoute(request, `session-${round}`);
        chosen.add(route!.stages[0]!.workerId);
      }
      expect(chosen).toEqual(new Set(workers.map((worker) => worker.id)));
    } finally {
      await database.close();
    }
  });

  it("never sends work to a clearly slower worker while a faster one is free", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const fast = await addWorker(store, { id: "fast", tokensPerSecond: 50 });
      await addWorker(store, { id: "slow", tokensPerSecond: 30 });
      const scheduler = new Scheduler(store);
      for (let round = 0; round < 40; round += 1) {
        const route = await scheduler.selectRoute({ ...request, max_tokens: 64 }, `session-${round}`);
        expect(route!.stages[0]!.workerId).toBe(fast.id);
      }
    } finally {
      await database.close();
    }
  });
});

describe("rejections after reading an offer", () => {
  it("reports a worker that rejects a large share of offers, once per window", () => {
    let now = 1_000_000;
    const monitor = new LeaseRejectionMonitor({ now: () => now });
    for (let offer = 0; offer < 10; offer += 1) monitor.offered("w");
    expect(monitor.rejected("w", "worker_capacity_exhausted")).toBeNull();
    expect(monitor.rejected("w", "model_not_allowed")).toBeNull();
    expect(monitor.rejected("w", "contribution_paused")).toMatchObject({ workerId: "w", offers: 10, rejections: 3, held: false });
    expect(monitor.rejected("w", "contribution_paused")).toBeNull();
    expect(monitor.isHeld("w")).toBe(false);
    now += 61 * 60_000;
    expect(monitor.rejected("w", "contribution_paused")).toBeNull();
  });

  it("tolerates occasional rejections from a busy honest worker", () => {
    const monitor = new LeaseRejectionMonitor();
    for (let offer = 0; offer < 100; offer += 1) monitor.offered("busy");
    for (let race = 0; race < 10; race += 1) expect(monitor.rejected("busy", "worker_capacity_exhausted")).toBeNull();
  });

  it("does not count rejections the coordinator can account for", () => {
    const monitor = new LeaseRejectionMonitor({ minRejections: 1, maxRejectionShare: 0 });
    monitor.offered("w");
    expect(monitor.rejected("w", "duplicate_job")).toBeNull();
    expect(monitor.rejected("w", "deadline_exceeded", true)).toBeNull();
    expect(monitor.rejected("w", "deadline_exceeded", false)).not.toBeNull();
  });

  it("holds an anomalous worker back from new offers only when enforcement is on, then releases it", () => {
    let now = 0;
    const monitor = new LeaseRejectionMonitor({ enforce: true, now: () => now });
    for (let rejection = 0; rejection < 3; rejection += 1) {
      monitor.offered("w");
      monitor.rejected("w", "outside_schedule");
    }
    expect(monitor.isHeld("w")).toBe(true);
    expect(monitor.offerable(new Set(["w", "other"]))).toEqual(new Set(["other"]));
    now += 60 * 60_000 + 1;
    expect(monitor.isHeld("w")).toBe(false);
  });

  it("emits an anomaly and stops offering to a held worker through the mesh service", async () => {
    const database = await MeshDatabase.open(":memory:");
    const hub = new RecordingHub();
    try {
      const store = new MeshStore(database);
      const reader = await addWorker(store, { id: "reader", tokensPerSecond: 60 });
      const honest = await addWorker(store, { id: "honest", tokensPerSecond: 20 });
      hub.connected.add(reader.id);
      hub.connected.add(honest.id);
      const service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000, {
        leaseRejectionHold: true,
      });
      const anomalies: unknown[] = [];
      service.on("lease_rejection_anomaly", (anomaly) => anomalies.push(anomaly));
      for (let round = 0; round < 3; round += 1) {
        const handle = await service.submit({ model: "distributed-small", messages: [{ role: "user", content: `note ${round}` }] });
        const offer = hub.sent.filter((message) => message.type === "lease.offer").at(-1)!;
        expect(offer.workerId).toBe(reader.id);
        hub.emit("envelope", {
          v: 1, type: "lease.reject", workerId: reader.id,
          payload: { jobId: handle.jobId, leaseId: (offer.payload as JobPayload).leaseId, reason: "model_not_allowed" },
        });
        await service.drainEvents();
        await service.cancel(handle.jobId);
      }
      expect(anomalies).toEqual([{ workerId: reader.id, offers: 3, rejections: 3, held: true }]);
      hub.sent.length = 0;
      const next = await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "after hold" }] });
      expect(hub.sent.find((message) => message.type === "lease.offer")!.workerId).toBe(honest.id);
      await service.cancel(next.jobId);
      await service.drainEvents();
    } finally {
      await database.close();
    }
  });
});
