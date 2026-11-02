import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatCompletionRequest,
  JobPayload,
  WorkerEnvelope,
} from "../src/contracts/types.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { inputHashForRequest } from "../src/core/request.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

interface SentMessage {
  workerId: string;
  type: string;
  payload: unknown;
}

class FakeWorkerHub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: SentMessage[] = [];

  connectedWorkerIds(): ReadonlySet<string> {
    return new Set(this.connected);
  }

  isConnected(workerId: string): boolean {
    return this.connected.has(workerId);
  }

  send(workerId: string, type: string, payload: unknown): boolean {
    this.sent.push({ workerId, type, payload });
    return this.isConnected(workerId);
  }

  workerMessage(envelope: WorkerEnvelope): void {
    this.emit("envelope", envelope);
  }
}

describe("active-route recovery policy", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  let hub: FakeWorkerHub;
  let service: MeshService;

  beforeEach(async () => {
    database = (await MeshDatabase.open(":memory:"));
    store = new MeshStore(database);
    hub = new FakeWorkerHub();
  });

  afterEach(async () => { await service?.drainEvents(); await database.close(); });

  it("admits a slower model under its explicit budget without raising other model deadlines", async () => {
    const worker = await addWorker(store, { id: "slow-chat", tokensPerSecond: 1.6 });
    hub.connected.add(worker.id);
    const request: ChatCompletionRequest = { model: "distributed-small", messages: [{ role: "user", content: "hello" }], max_tokens: 1024, deadline_ms: 900_000 };
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 120_000, { modelRequestTimeoutsMs: { "distributed-small": 900_000 } });
    const handle = await service.submit(request);
    const job = (await store.getJob(handle.jobId))!;
    expect(job.deadlineAt - job.createdAt).toBeGreaterThan(890_000);
    expect(await service.cancel(handle.jobId)).toBe(true);
    const short = await service.submit({ ...request, deadline_ms: 700_000 });
    expect((await store.getJob(short.jobId))!.deadlineAt - (await store.getJob(short.jobId))!.createdAt).toBeLessThanOrEqual(700_000);
    expect(await service.cancel(short.jobId)).toBe(true);
  });

  it("keeps long-prompt first-token waiting bounded for a configured model", async () => {
    vi.useFakeTimers();
    try {
      const worker = await addWorker(store, { id: "slow-prefill", tokensPerSecond: 1.6 });
      hub.connected.add(worker.id);
      service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 120_000, { modelRequestTimeoutsMs: { "distributed-small": 900_000 } });
      const handle = await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "hello" }], max_tokens: 1024, deadline_ms: 900_000 });
      const lease = leaseOffers(hub)[0]!;
      hub.workerMessage({ v: 1, type: "lease.accept", workerId: worker.id, payload: { jobId: handle.jobId, leaseId: lease.payload.leaseId } });
      await vi.advanceTimersByTimeAsync(20_000);
      expect((await store.getJob(handle.jobId))!.status).toBe("running");
      await vi.advanceTimersByTimeAsync(100_001);
      expect((await store.getJob(handle.jobId))!.status).toBe("failed");
      expect((await store.getJob(handle.jobId))!.failureCode).toBe("first_token_timeout");
    } finally { vi.useRealTimers(); }
  });

  it("fails closed when only an anonymous worker can receive a sensitive boundary", async () => {
    const anonymous = (await addWorker(store, { id: "anonymous", trusted: false }));
    hub.connected.add(anonymous.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    await expect((async () => (await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "private" }] })))()).rejects
      .toThrow(expect.objectContaining({ code: "trusted_boundary_unavailable", statusCode: 503 }));
    expect(hub.sent).toHaveLength(0);
  });

  it("does not silently ignore an explicit boundary pin", async () => {
    const trusted = (await addWorker(store, { id: "trusted" }));
    hub.connected.add(trusted.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    await expect((async () => (await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "private" }],
      privacy: { trust: "default", boundary: "pinned-edges", pinned_identity_ids: ["some-other-device"] } })))()).rejects
      .toThrow(expect.objectContaining({ code: "boundary_pin_unavailable", statusCode: 503 }));
    expect(hub.sent).toHaveLength(0);
  });

  it("supersedes an identical orphaned request after the client reconnects", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
    ));
    const request: ChatCompletionRequest = {
      model: "distributed-small",
      messages: [{ role: "user", content: "mismo mensaje" }],
      max_tokens: 32,
      stream: true,
    };
    const first = (await service.submit(request, "reconnected-session"));

    expect((await service.cancelMatchingActiveSession(
      structuredClone(request),
      "reconnected-session",
    ))).toBe(first.jobId);
    expect((await store.getJob(first.jobId))?.status).toBe("cancelled");
    expect(hub.sent).toContainEqual({
      workerId: primary.id,
      type: "task.cancel",
      payload: { jobId: first.jobId },
    });

    const replacement = (await service.submit(structuredClone(request), "reconnected-session"));
    expect(replacement.jobId).not.toBe(first.jobId);
    expect((await service.cancel(replacement.jobId))).toBe(true);
  });

  it("keeps session_busy protection for a different concurrent message", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
    ));
    const first = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "primer mensaje" }],
      max_tokens: 32,
      stream: true,
    }, "protected-session"));

    const different: ChatCompletionRequest = {
      model: "distributed-small",
      messages: [{ role: "user", content: "mensaje diferente" }],
      max_tokens: 32,
      stream: true,
    };
    expect((await service.cancelMatchingActiveSession(different, "protected-session"))).toBeNull();
    await expect((async () => (await service.submit(different, "protected-session")))()).rejects.toThrow(
      "Session already has an active request",
    );
    expect((await store.getJob(first.jobId))?.status).not.toBe("cancelled");
    expect((await service.cancel(first.jobId))).toBe(true);
  });

  it("replays the immutable prompt checkpoint on an exact-revision standby before token zero", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    const incompatible = (await addWorker(store, {
      id: "incompatible",
      modelDigest: "sha256:revision-b",
      tokensPerSecond: 40,
    }));
    const standby = (await addWorker(store, {
      id: "standby",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 30,
    }));
    hub.connected.add(primary.id);
    hub.connected.add(incompatible.id);
    hub.connected.add(standby.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
    ));
    const request: ChatCompletionRequest = {
      model: "distributed-small",
      messages: [{ role: "user", content: "prompt original" }],
      max_tokens: 32,
      seed: 7,
    };

    const handle = (await service.submit(request, "failover-session"));
    request.messages[0]!.content = "mutated after submit";
    const firstOffer = leaseOffers(hub)[0]!;
    expect(firstOffer.workerId).toBe(primary.id);

    hub.workerMessage({
      v: 1,
      type: "lease.reject",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: firstOffer.payload.leaseId,
        reason: "worker_busy",
      },
    });
    await service.drainEvents();

    const offers = leaseOffers(hub);
    expect(offers).toHaveLength(2);
    expect(offers[1]!.workerId).toBe(standby.id);
    expect(offers[1]!.workerId).not.toBe(incompatible.id);
    expect(offers[1]!.payload.request.messages[0]?.content).toBe("prompt original");
    expect(inputHashForRequest(offers[1]!.payload.request)).toBe(
      inputHashForRequest(firstOffer.payload.request),
    );
    expect(hub.sent).toContainEqual({
      workerId: primary.id,
      type: "task.cancel",
      payload: { jobId: handle.jobId },
    });
    expect((await store.getJob(handle.jobId))?.workerId).toBe(standby.id);

    expect((await service.cancel(handle.jobId))).toBe(true);
  });

  it("revalidates a preplanned standby and atomically promotes the next eligible route", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    const staleStandby = (await addWorker(store, {
      id: "stale-standby",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 40,
    }));
    const healthyStandby = (await addWorker(store, {
      id: "healthy-standby",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 30,
    }));
    for (const worker of [primary, staleStandby, healthyStandby]) hub.connected.add(worker.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "recover safely" }],
      seed: 11,
    }, "atomic-promotion-session"));
    const firstOffer = leaseOffers(hub)[0]!;

    const exhausted = structuredClone(staleStandby.capabilities);
    exhausted.deployments[0]!.freeSlots = 0;
    (await store.updateWorkerHeartbeat(staleStandby.id, exhausted, "online"));
    hub.workerMessage({
      v: 1,
      type: "lease.reject",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: firstOffer.payload.leaseId, reason: "worker_busy" },
    });
    await service.drainEvents();

    const offers = leaseOffers(hub);
    expect(offers).toHaveLength(2);
    expect(offers[1]!.workerId).toBe(healthyStandby.id);
    expect(offers.some((offer) => offer.workerId === staleStandby.id)).toBe(false);
    expect((await store.getJob(handle.jobId))).toMatchObject({
      status: "leasing",
      workerId: healthyStandby.id,
      leaseId: offers[1]!.payload.leaseId,
      failureCode: null,
    });
    expect(hub.sent).toContainEqual({
      workerId: primary.id,
      type: "task.cancel",
      payload: { jobId: handle.jobId },
    });
    hub.workerMessage({
      v: 1,
      type: "task.complete",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: firstOffer.payload.leaseId,
        text: "late",
        finishReason: "stop",
        metrics: { inputTokens: 2, outputTokens: 1, ttftMs: 1, activeMs: 2 },
      },
    });
    await service.drainEvents();
    expect((await store.getJob(handle.jobId))).toMatchObject({
      status: "leasing",
      workerId: healthyStandby.id,
      leaseId: offers[1]!.payload.leaseId,
    });
    expect((await service.cancel(handle.jobId))).toBe(true);
  });

  it("does not restart after an empty token event because streaming has already begun", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    const standby = (await addWorker(store, {
      id: "standby",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 30,
    }));
    hub.connected.add(primary.id);
    hub.connected.add(standby.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
    ));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "hola" }],
      max_tokens: 32,
    }));
    const firstOffer = leaseOffers(hub)[0]!;

    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: firstOffer.payload.leaseId },
    });
    await service.drainEvents();
    hub.workerMessage({
      v: 1,
      type: "task.token",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: firstOffer.payload.leaseId,
        index: 0,
        text: "",
      },
    });
    await service.drainEvents();
    hub.workerMessage({
      v: 1,
      type: "task.fail",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: firstOffer.payload.leaseId,
        code: "gpu_lost",
      },
    });
    await service.drainEvents();

    expect(leaseOffers(hub)).toHaveLength(1);
    expect((await store.getJob(handle.jobId))?.status).toBe("failed");
    expect((await store.getJob(handle.jobId))?.failureCode).toBe("gpu_lost");
  });

  it("replays a seeded committed prefix on an exact-revision standby without duplicate output", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    const standby = (await addWorker(store, {
      id: "standby",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 30,
    }));
    hub.connected.add(primary.id);
    hub.connected.add(standby.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "deterministic" }],
      max_tokens: 16,
      seed: 42,
    }));
    const first = leaseOffers(hub)[0]!;
    hub.workerMessage({ v: 1, type: "lease.accept", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId } });
    await service.drainEvents();
    for (const [index, text] of ["A", "B"].entries()) {
      hub.workerMessage({ v: 1, type: "task.token", workerId: primary.id,
        payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, index, text } });
    await service.drainEvents();
    }
    hub.workerMessage({ v: 1, type: "task.fail", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, code: "gpu_lost" } });
    await service.drainEvents();

    const second = leaseOffers(hub)[1]!;
    expect(second.workerId).toBe(standby.id);
    hub.workerMessage({ v: 1, type: "lease.accept", workerId: standby.id,
      payload: { jobId: handle.jobId, leaseId: second.payload.leaseId } });
    await service.drainEvents();
    for (const [index, text] of ["A", "B", "C"].entries()) {
      hub.workerMessage({ v: 1, type: "task.token", workerId: standby.id,
        payload: { jobId: handle.jobId, leaseId: second.payload.leaseId, index, text } });
    await service.drainEvents();
    }
    hub.workerMessage({ v: 1, type: "task.complete", workerId: standby.id,
      payload: { jobId: handle.jobId, leaseId: second.payload.leaseId, text: "ABC", finishReason: "stop",
        metrics: { inputTokens: 8, outputTokens: 3, ttftMs: 20, activeMs: 40 } } });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.filter((event) => event.type === "token")).toEqual([
      { type: "token", token: { index: 0, text: "A" } },
      { type: "token", token: { index: 1, text: "B" } },
      { type: "token", token: { index: 2, text: "C" } },
    ]);
    expect(events).toContainEqual(expect.objectContaining({
      type: "progress",
      phase: "recovering",
      recoveryMode: "deterministic-prefix-replay",
      message: expect.stringContaining("duplicate output is suppressed"),
    }));
    expect(events.at(-1)).toMatchObject({ type: "completed", result: {
      text: "ABC",
      recovery: { mode: "deterministic-prefix-replay", attempts: 2, replayedTokenEvents: 2 },
    } });
  });

  it("fails closed when the exact-revision standby diverges from the committed prefix", async () => {
    const primary = (await addWorker(store, { id: "primary", modelDigest: "sha256:revision-a", tokensPerSecond: 50 }));
    const standby = (await addWorker(store, { id: "standby", modelDigest: "sha256:revision-a", tokensPerSecond: 30 }));
    hub.connected.add(primary.id);
    hub.connected.add(standby.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "deterministic" }], seed: 7 }));
    const first = leaseOffers(hub)[0]!;
    hub.workerMessage({ v: 1, type: "task.token", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, index: 0, text: "A" } });
    await service.drainEvents();
    hub.workerMessage({ v: 1, type: "task.fail", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, code: "gpu_lost" } });
    await service.drainEvents();
    const second = leaseOffers(hub)[1]!;
    hub.workerMessage({ v: 1, type: "task.token", workerId: standby.id,
      payload: { jobId: handle.jobId, leaseId: second.payload.leaseId, index: 0, text: "X" } });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "replay_prefix_mismatch" });
    expect((await store.getJob(handle.jobId))?.status).toBe("failed");
  });

  it("rejects standby completion before the committed prefix has been replayed", async () => {
    const primary = (await addWorker(store, { id: "primary", modelDigest: "sha256:revision-a", tokensPerSecond: 50 }));
    const standby = (await addWorker(store, { id: "standby", modelDigest: "sha256:revision-a", tokensPerSecond: 30 }));
    hub.connected.add(primary.id);
    hub.connected.add(standby.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({ model: "distributed-small", messages: [{ role: "user", content: "deterministic" }], seed: 9 }));
    const first = leaseOffers(hub)[0]!;
    hub.workerMessage({ v: 1, type: "task.token", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, index: 0, text: "A" } });
    await service.drainEvents();
    hub.workerMessage({ v: 1, type: "task.fail", workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: first.payload.leaseId, code: "gpu_lost" } });
    await service.drainEvents();
    const second = leaseOffers(hub)[1]!;
    hub.workerMessage({ v: 1, type: "task.complete", workerId: standby.id,
      payload: { jobId: handle.jobId, leaseId: second.payload.leaseId, text: "A", finishReason: "stop",
        metrics: { inputTokens: 8, outputTokens: 1, ttftMs: 20, activeMs: 40 } } });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "replay_prefix_incomplete" });
  });

  it("preserves the adapter failure message when no standby remains", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      tokensPerSecond: 50,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
    ));
    const degradedEvents: Array<{
      jobId: string;
      model: string;
      code: string;
      workerId: string | null;
    }> = [];
    service.on("degraded", (event) => degradedEvents.push(event));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "hola" }],
      max_tokens: 32,
    }));
    const offer = leaseOffers(hub)[0]!;

    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId },
    });
    await service.drainEvents();
    hub.workerMessage({
      v: 1,
      type: "task.fail",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: offer.payload.leaseId,
        code: "adapter_error",
        message: "Backend requires greedy temperature=0",
      },
    });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "adapter_error",
      message: "Backend requires greedy temperature=0",
    });
    expect(degradedEvents).toEqual([expect.objectContaining({
      jobId: handle.jobId,
      model: "distributed-small",
      code: "adapter_error",
    })]);
  });

  it("fails fast when an accepted route never emits its first token", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      ttftMs: 1,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(
      store,
      new Scheduler(store),
      hub as unknown as WorkerHub,
      30_000,
      { firstTokenTimeoutMs: 20 },
    ));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "hola" }],
      max_tokens: 32,
    }));
    const offer = leaseOffers(hub)[0]!;
    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId },
    });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({
      type: "progress",
      phase: "waiting_first_token",
    }));
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "first_token_timeout",
    });
    expect((await store.getJob(handle.jobId))?.status).toBe("failed");
  });

  it("attributes a distributed request failure to the physical stage that disconnected", async () => {
    const physical = (await addWorker(store, {
      id: "physical-amd",
      model: "unrelated-model",
      distributedExecutor: {
        protocol: "gdlp-worker-tunnel/2",
        nodeId: "desktop-amd",
        stageHost: "desktop-amd.relay",
        stagePort: 43110,
        runtime: "python-safetensors",
        computeMode: "gpu-only",
        cpuEligible: false,
      },
    }));
    const cell = (await addWorker(store, {
      id: "cell",
      model: "distributed-small",
      modelDigest: "sha256:revision-a",
      internalPipeline: { stageCount: 1, boundaries: [0, 14] },
      execution: {
        deviceType: "gpu",
        backend: "rocm",
        deviceName: "AMD pipeline",
        precision: "float16",
        fallback: false,
        stages: [{
          nodeId: "desktop-amd",
          stageIndex: 0,
          layerStart: 0,
          layerEnd: 14,
          deviceType: "gpu",
          backend: "rocm",
          deviceName: "AMD Radeon",
          precision: "float16",
          fallback: false,
        }],
      },
    }));
    hub.connected.add(physical.id);
    hub.connected.add(cell.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "hola" }],
      max_tokens: 32,
    }));
    const offer = leaseOffers(hub)[0]!;
    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: cell.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId },
    });
    await service.drainEvents();

    hub.connected.delete(physical.id);
    hub.emit("disconnect", physical.id);
    const events = [];
    for await (const event of handle.events) events.push(event);

    expect(events).toContainEqual(expect.objectContaining({
      type: "progress",
      phase: "recovering",
      nodeId: "desktop-amd",
      workerId: physical.id,
    }));
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "pipeline_stage_disconnected",
      message: expect.stringContaining("AMD Radeon"),
    });
  });

  it("accepts tokenizer-specific chat-template overhead within the certified context", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      contextLimit: 128,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "Reply with only OK" }],
      max_tokens: 16,
    }));
    const offer = leaseOffers(hub)[0]!;

    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId },
    });
    await service.drainEvents();
    hub.workerMessage({
      v: 1,
      type: "task.token",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId, index: 0, text: "OK" },
    });
    await service.drainEvents();
    hub.workerMessage({
      v: 1,
      type: "task.complete",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: offer.payload.leaseId,
        text: "OK",
        finishReason: "stop",
        metrics: { inputTokens: 32, outputTokens: 1, ttftMs: 20, activeMs: 40 },
      },
    });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { metrics: { inputTokens: 32, outputTokens: 1 } },
    });
    expect((await store.getJob(handle.jobId))?.status).toBe("completed");
  });

  it("accepts real output-token counts that differ from characters divided by four", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      contextLimit: 128,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 16,
    }));
    const offer = leaseOffers(hub)[0]!;
    const pieces = Array.from({ length: 16 }, () => "é");

    hub.workerMessage({
      v: 1,
      type: "lease.accept",
      workerId: primary.id,
      payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId },
    });
    await service.drainEvents();
    for (const [index, text] of pieces.entries()) {
      hub.workerMessage({
        v: 1,
        type: "task.token",
        workerId: primary.id,
        payload: { jobId: handle.jobId, leaseId: offer.payload.leaseId, index, text },
      });
    await service.drainEvents();
    }
    hub.workerMessage({
      v: 1,
      type: "task.complete",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: offer.payload.leaseId,
        text: pieces.join(""),
        finishReason: "length",
        metrics: { inputTokens: 9, outputTokens: 16, ttftMs: 20, activeMs: 40 },
      },
    });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      result: { metrics: { inputTokens: 9, outputTokens: 16 } },
    });
    expect((await store.getJob(handle.jobId))?.status).toBe("completed");
  });

  it("still rejects reported input tokens beyond the deployment context", async () => {
    const primary = (await addWorker(store, {
      id: "primary",
      modelDigest: "sha256:revision-a",
      contextLimit: 128,
    }));
    hub.connected.add(primary.id);
    service = (await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000));
    const handle = (await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "short prompt" }],
      max_tokens: 16,
    }));
    const offer = leaseOffers(hub)[0]!;

    hub.workerMessage({
      v: 1,
      type: "task.complete",
      workerId: primary.id,
      payload: {
        jobId: handle.jobId,
        leaseId: offer.payload.leaseId,
        text: "",
        finishReason: "stop",
        metrics: { inputTokens: 129, outputTokens: 1, ttftMs: 20, activeMs: 40 },
      },
    });
    await service.drainEvents();

    const events = [];
    for await (const event of handle.events) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "failed",
      code: "invalid_completion",
      message: "Implausible input token count",
    });
    expect((await store.getJob(handle.jobId))?.status).toBe("failed");
  });
});

function leaseOffers(hub: FakeWorkerHub): Array<{
  workerId: string;
  payload: JobPayload;
}> {
  return hub.sent
    .filter((message) => message.type === "lease.offer")
    .map((message) => ({ workerId: message.workerId, payload: message.payload as JobPayload }));
}
