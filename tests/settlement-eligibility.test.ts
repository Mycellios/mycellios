import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionRequest, ModelDeployment, WorkerCapabilities } from "../src/contracts/types.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredWorker } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

const MODEL = "mycellios-kokoro-es";
const SOURCE = `sha256:${"a".repeat(64)}`;
const request: ChatCompletionRequest = { model: MODEL, messages: [{ role: "user", content: "hola" }], max_tokens: 1 };

class Hub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  send(workerId: string, type: string, payload: unknown): boolean {
    this.sent.push({ workerId, type, payload });
    return this.isConnected(workerId);
  }
}

/** A Kokoro-like native replica, optionally with coordinator-attested qualification. */
async function replica(store: MeshStore, id: string, evidence: "fresh" | "stale" | "other-build" | "none"): Promise<StoredWorker> {
  const worker = await addWorker(store, { id, model: MODEL, modelDigest: "sha256:kokoro", tokensPerSecond: 10 });
  const capabilities: WorkerCapabilities = structuredClone(worker.capabilities);
  capabilities.buildIdentity = { sourceId: SOURCE } as never;
  const base = capabilities.deployments[0]!;
  const observedAt = evidence === "stale" ? Date.now() - 8 * 24 * 60 * 60_000 : Date.now() - 60_000;
  const deployment: ModelDeployment = { ...base, adapter: "kokoro", activationId: `act-${id}`,
    ...(evidence === "none" ? {} : {
      verificationState: "verified",
      nativeReplicaEvidence: {
        workerId: worker.id, deploymentId: base.deploymentId, model: MODEL, modelDigest: base.modelDigest,
        activationId: `act-${id}`, buildSourceId: evidence === "other-build" ? `sha256:${"b".repeat(64)}` : SOURCE,
        observedAt,
      } as never,
    }) };
  capabilities.deployments = [deployment];
  await store.updateWorkerHeartbeat(worker.id, capabilities, "online");
  return (await store.getWorker(worker.id))!;
}

describe("settlement eligibility for contribution-funded requests (specs/node-owner-privacy D7)", () => {
  let database: MeshDatabase;
  let store: MeshStore;

  beforeEach(async () => {
    database = await MeshDatabase.open(":memory:");
    store = new MeshStore(database);
  });

  afterEach(async () => {
    await database.close();
  });

  it("routes funded work only to replicas with fresh qualification for this worker and build", async () => {
    const scheduler = new Scheduler(store);
    const funded = { routePolicy: { requireSettlementEvidence: true } };
    for (const evidence of ["none", "stale", "other-build"] as const) {
      const worker = await replica(store, `w-${evidence}`, evidence);
      expect(await scheduler.selectRoute(request, `s-${evidence}`, { ...funded, connectedWorkerIds: new Set([worker.id]) })).toBeNull();
      expect((await scheduler.selectRoute(request, `u-${evidence}`, { connectedWorkerIds: new Set([worker.id]) }))?.stages[0]?.workerId).toBe(worker.id);
    }
    const qualified = await replica(store, "w-fresh", "fresh");
    expect((await scheduler.selectRoute(request, "s-fresh", { ...funded, connectedWorkerIds: new Set([qualified.id]) }))?.stages[0]?.workerId)
      .toBe(qualified.id);
  });

  it("leaves other adapters to their own evidence rules", async () => {
    const plain = await addWorker(store, { id: "plain" });
    const route = await new Scheduler(store).selectRoute({ model: "distributed-small", messages: [{ role: "user", content: "x" }] }, "s",
      { routePolicy: { requireSettlementEvidence: true }, connectedWorkerIds: new Set([plain.id]) });
    expect(route?.stages[0]?.workerId).toBe(plain.id);
  });

  it("refuses a funded request before dispatch when only unqualified replicas exist, and serves unfunded work", async () => {
    const hub = new Hub();
    const unqualified = await replica(store, "lapsed", "none");
    hub.connected.add(unqualified.id);
    const service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    try {
      await expect(service.submit(request, undefined, undefined, undefined, { requireSettlementEvidence: true }))
        .rejects.toThrow(expect.objectContaining({ code: "settlement_evidence_unavailable", statusCode: 502 }));
      expect(hub.sent.filter((message) => message.type === "lease.offer")).toHaveLength(0);
      const unfunded = await service.submit(request);
      expect(hub.sent.filter((message) => message.type === "lease.offer").map((message) => message.workerId)).toEqual([unqualified.id]);
      await service.cancel(unfunded.jobId);

      hub.sent.length = 0;
      const qualified = await replica(store, "requalified", "fresh");
      hub.connected.add(qualified.id);
      const funded = await service.submit(request, undefined, undefined, undefined, { requireSettlementEvidence: true });
      expect(hub.sent.filter((message) => message.type === "lease.offer").map((message) => message.workerId)).toEqual([qualified.id]);
      await service.cancel(funded.jobId);
    } finally {
      await service.drainEvents();
    }
  });

  it("keeps no_capacity when no replica exists at all", async () => {
    const service = await MeshService.create(store, new Scheduler(store), new Hub() as unknown as WorkerHub, 30_000);
    await expect(service.submit(request, undefined, undefined, undefined, { requireSettlementEvidence: true }))
      .rejects.toThrow(expect.objectContaining({ code: "no_capacity", statusCode: 503 }));
    await service.drainEvents();
  });
});
