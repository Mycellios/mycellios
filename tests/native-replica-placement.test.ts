import { describe, expect, it, vi } from "vitest";
import { DeploymentControlPlane } from "../src/coordinator/deployment-control-plane.js";
import {
  NativeReplicaPlacementBroker,
  nativeReplicaPlacementConfigSchema,
  planReplicaPlacement,
  ReplicaDemandLedger,
  type PlacementInput,
  type PlacementReplica,
} from "../src/coordinator/native-replica-placement.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredWorker } from "../src/storage/store.js";

const MINUTE = 60_000;
const NOW = 10_000_000;
const NODE = "node-gpu";

function replica(consumerId: string, overrides: Partial<PlacementReplica> = {}): PlacementReplica {
  return {
    consumerId,
    nodeId: NODE,
    memoryMiB: 2048,
    priority: 50,
    pinned: false,
    demand: { lastRequestAt: 0, unservedSince: null },
    heldSince: null,
    busy: false,
    ...overrides,
  };
}

function input(replicas: PlacementReplica[], overrides: Partial<PlacementInput> = {}): PlacementInput {
  return {
    now: NOW,
    idleMs: 10 * MINUTE,
    minResidencyMs: 3 * MINUTE,
    capacityByNode: new Map([[NODE, 5221]]),
    drainingByNode: new Map(),
    replicas,
    ...overrides,
  };
}

const held = (since = NOW - 60 * MINUTE) => ({ heldSince: since });
const idle = { demand: { lastRequestAt: NOW - 30 * MINUTE, unservedSince: null } };
const wanted = (since = NOW - 1_000) => ({ demand: { lastRequestAt: NOW - 1_000, unservedSince: since } });

describe("planReplicaPlacement", () => {
  it("fills free capacity with warm replicas by recent demand, then priority", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", { priority: 10 }),
      replica("whisper", { priority: 20 }),
      replica("embedding", { priority: 30, demand: { lastRequestAt: NOW - MINUTE, unservedSince: null } }),
    ]));
    expect(decision.grant).toEqual(["embedding", "kokoro"]);
    expect(decision.release).toEqual([]);
  });

  it("releases the least recently used idle replica for a model with unserved demand", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", { ...held(), demand: { lastRequestAt: NOW - 20 * MINUTE, unservedSince: null } }),
      replica("whisper", { ...held(), demand: { lastRequestAt: NOW - 40 * MINUTE, unservedSince: null } }),
      replica("embedding", wanted()),
    ]));
    expect(decision.release).toEqual(["whisper"]);
    expect(decision.keep).toEqual(["kokoro"]);
    // The released process must exit before its memory is granted again.
    expect(decision.grant).toEqual([]);
    expect(decision.waiting).toEqual(["embedding"]);
  });

  it("grants the waiting replica once the released memory has drained", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", { ...held(), ...idle }),
      replica("whisper", idle),
      replica("embedding", wanted()),
    ]));
    expect(decision.grant).toEqual(["embedding"]);
    expect(decision.release).toEqual([]);
  });

  it("does not grant memory that a released replica still occupies", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", { ...held(), ...idle }),
      replica("embedding", wanted()),
    ], { drainingByNode: new Map([[NODE, 2048]]) }));
    expect(decision.grant).toEqual([]);
    expect(decision.waiting).toEqual(["embedding"]);
  });

  it("never releases a busy, pinned, recently used or recently loaded replica", () => {
    const cases: Array<Partial<PlacementReplica>> = [
      { ...held(), ...idle, busy: true },
      { ...held(), ...idle, pinned: true },
      { ...held(), demand: { lastRequestAt: NOW - MINUTE, unservedSince: null } },
      { ...held(NOW - MINUTE), ...idle },
    ];
    for (const occupant of cases) {
      const decision = planReplicaPlacement(input([
        replica("kokoro", { ...held(), ...idle, pinned: true }),
        replica("whisper", occupant),
        replica("embedding", wanted()),
      ]));
      expect(decision.release).toEqual([]);
      expect(decision.waiting).toEqual(["embedding"]);
    }
  });

  it("serves the oldest unserved demand first", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", wanted(NOW - 5_000)),
      replica("whisper", wanted(NOW - 50_000)),
      replica("embedding", wanted(NOW - 20_000)),
    ]));
    expect(decision.grant).toEqual(["embedding", "whisper"]);
    expect(decision.waiting).toEqual(["kokoro"]);
  });

  it("releases reservations on a node that is no longer eligible", () => {
    const decision = planReplicaPlacement(input([replica("kokoro", held())], { capacityByNode: new Map() }));
    expect(decision.release).toEqual(["kokoro"]);
    expect(decision.keep).toEqual([]);
  });

  it("leaves a replica larger than its node waiting instead of evicting everything", () => {
    const decision = planReplicaPlacement(input([
      replica("kokoro", { ...held(), ...idle }),
      replica("huge", { ...wanted(), memoryMiB: 8192 }),
    ]));
    expect(decision.release).toEqual([]);
    expect(decision.waiting).toEqual(["huge"]);
  });
});

describe("ReplicaDemandLedger", () => {
  it("tracks only configured models and clears unserved demand once served", () => {
    const ledger = new ReplicaDemandLedger(new Set(["embedding-a", "embedding-b"]));
    ledger.record("other", false, 1);
    ledger.record("embedding-a", false, 10);
    ledger.record("embedding-b", false, 20);
    expect(ledger.forReplica({ requestModels: ["embedding-a", "embedding-b"] })).toEqual({ lastRequestAt: 20, unservedSince: 10 });
    ledger.record("embedding-a", false, 30);
    expect(ledger.forReplica({ requestModels: ["embedding-a"] })).toEqual({ lastRequestAt: 30, unservedSince: 10 });
    ledger.record("embedding-a", true, 40);
    expect(ledger.forReplica({ requestModels: ["embedding-a"] })).toEqual({ lastRequestAt: 40, unservedSince: null });
    expect(ledger.forReplica({ requestModels: ["other"] })).toEqual({ lastRequestAt: 0, unservedSince: null });
  });
});

describe("NativeReplicaPlacementBroker", () => {
  const fingerprint = `sha256:${"a".repeat(64)}`;
  const config = (replicas: Array<{ id: string; priority: number }>) => nativeReplicaPlacementConfigSchema.parse({
    schema: "mycellios-native-replica-placement/1",
    replicas: replicas.map(({ id, priority }) => ({
      consumerId: `${id}-consumer`,
      modelId: `${id}-gpu`,
      requestModels: [id],
      source: `org/${id}`,
      revision: "r1",
      nodeId: NODE,
      deviceName: "NVIDIA GeForce RTX 2060",
      gpuFingerprint: fingerprint,
      memoryMiB: 2048,
      priority,
      canaryReceiptPath: "/unused",
      canaryReceiptSha256: "b".repeat(64),
      operationMetadata: { coreSha256: "c".repeat(64) },
      canary: { passed: true, backend: "cuda", consumerId: `${id}-consumer`, nodeId: NODE },
    })),
  });
  const gpuWorker = (now: number) => ({
    id: "wrk-gpu",
    status: "online",
    lastSeenAt: now,
    identityKind: "device",
    identityId: NODE,
    reliability: 1,
    jobsCompleted: 0,
    capabilities: {
      deployments: [],
      gpus: [{ id: "gpu0", vendor: "nvidia", model: "NVIDIA GeForce RTX 2060", physicalVramMb: 6143, offeredVramMb: 6143, freeOfferedVramMb: 6143 }],
      distributedExecutor: {
        nodeId: NODE,
        acceleration: { state: "gpu-ready", backend: "cuda" },
        physicalIdentity: { gpuFingerprintsSha256: [fingerprint] },
      },
    },
  }) as unknown as StoredWorker;

  it("commits reservations the replica runner accepts, then hands memory to the model in demand", async () => {
    const database = await MeshDatabase.open(":memory:");
    const store = new MeshStore(database);
    let now = NOW;
    vi.spyOn(store, "listWorkers").mockImplementation(async () => [gpuWorker(now)]);
    const placement = config([{ id: "kokoro", priority: 10 }, { id: "whisper", priority: 20 }, { id: "embedding", priority: 30 }]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const broker = new NativeReplicaPlacementBroker(store, placement, logger);

    const first = await broker.tick(now);
    expect(first.grant).toEqual(["kokoro-consumer", "whisper-consumer"]);
    const timeline = await new DeploymentControlPlane(store).timeline("kokoro-gpu");
    const reservation = timeline!.reservations.at(-1)!;
    expect(reservation).toMatchObject({ status: "committed", stages: [{ nodeId: NODE, memoryMiB: 2048, layerStart: 0, layerEnd: 1 }] });
    expect(reservation.canary).toMatchObject({ consumerId: "kokoro-consumer", nodeId: NODE, backend: "cuda" });
    const operation = timeline!.operations.find(candidate => candidate.id === reservation.operationId)!;
    expect(operation.metadata).toMatchObject({ consumerId: "kokoro-consumer", coreSha256: "c".repeat(64) });
    expect(operation.status).toBe("succeeded");

    // Renewals keep both reservations alive while nothing else is wanted.
    for (let step = 0; step < 15; step += 1) {
      now += 2 * MINUTE;
      expect((await broker.tick(now)).keep).toEqual(["kokoro-consumer", "whisper-consumer"]);
    }
    broker.demand.record("kokoro", true, now - MINUTE);
    broker.demand.record("embedding", false, now);
    const second = await broker.tick(now);
    expect(second.release).toEqual(["whisper-consumer"]);
    expect(second.waiting).toEqual(["embedding-consumer"]);
    expect((await new DeploymentControlPlane(store).listReservations("whisper-gpu")).at(-1)!.status).toBe("released");

    now += 60_000;
    const third = await broker.tick(now);
    expect(third.grant).toEqual(["embedding-consumer"]);
    expect(third.keep).toEqual(["kokoro-consumer"]);
    expect((await new DeploymentControlPlane(store).listReservations("embedding-gpu")).at(-1)!.status).toBe("committed");
    expect(logger.warn).not.toHaveBeenCalled();
    await database.close();
  });
});
