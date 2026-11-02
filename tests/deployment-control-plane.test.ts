import { describe, expect, it } from "vitest";
import { DeploymentControlPlane } from "../src/coordinator/deployment-control-plane.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";

describe("durable deployment control plane", () => {
  it("tracks desired and observed generations and claims operations idempotently", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const store = new MeshStore(database);
    const model = (await addModel(store, "qwen"));
    const controller = new DeploymentControlPlane(store, "controller-a");

    expect((await controller.initialize(1_000))).toEqual({
      models: 1,
      interruptedOperations: 0,
      expiredReservations: 0,
    });
    expect((await controller.getState(model.id))).toMatchObject({
      desiredState: "active",
      observedState: "inactive",
      generation: 1,
      observedGeneration: 0,
    });

    const operation = (await controller.claimOperation(model.id, "activate", {
      now: 2_000,
      leaseMs: 30_000,
    }));
    const duplicate = (await controller.claimOperation(model.id, "activate", {
      now: 2_100,
      leaseMs: 30_000,
    }));
    expect(operation).not.toBeNull();
    expect(duplicate?.id).toBe(operation?.id);
    expect((await controller.listOperations(model.id))).toHaveLength(1);
    expect((await controller.getState(model.id))).toMatchObject({
      observedState: "preparing",
      activeOperationId: operation?.id,
      controllerOwner: "controller-a",
    });

    expect((await controller.completeOperation(operation!.id, "active", {}, 3_000))).toBe(true);
    expect((await controller.getState(model.id))).toMatchObject({
      desiredState: "active",
      observedState: "active",
      observedGeneration: 1,
      retryCount: 0,
      activeOperationId: null,
    });

    expect((await controller.setDesiredState(model.id, "inactive", 4_000))).toMatchObject({
      desiredState: "inactive",
      generation: 2,
      observedGeneration: 1,
    });
    (await database.close());
  });

  it("reserves stage capacity atomically and publishes only after a canary commit", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const store = new MeshStore(database);
    (await addModel(store, "model-a"));
    (await addModel(store, "model-b"));
    const controller = new DeploymentControlPlane(store, "controller-a");
    (await controller.initialize(1_000));
    const first = (await controller.claimOperation("model-a", "activate", { now: 2_000 }))!;
    const second = (await controller.claimOperation("model-b", "activate", { now: 2_000 }))!;

    const reservation = (await controller.prepareRoute(first.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 12,
      memoryMiB: 700,
      capacityMiB: 1_000,
    }], 60_000, 2_100));
    expect(reservation.status).toBe("prepared");
    expect((await controller.getState("model-a"))?.observedState).toBe("preparing");

    await expect(async () => (await controller.prepareRoute(second.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 8,
      memoryMiB: 400,
      capacityMiB: 1_000,
    }], 60_000, 2_200))).rejects.toThrow("route_capacity_conflict:node-a");

    const committed = (await controller.commitRoute(reservation.id, {
      passed: true,
      ttftMs: 120,
      tokensPerSecond: 8.5,
    }, 2_300));
    expect(committed.status).toBe("committed");
    expect((await controller.getState("model-a"))).toMatchObject({
      observedState: "active",
      observedGeneration: 1,
      activeOperationId: null,
    });
    expect((await controller.getOperation(first.id))?.status).toBe("succeeded");

    expect((await controller.releaseRoutesForModel("model-a", 2_400))).toBe(1);
    const replacement = (await controller.prepareRoute(second.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 8,
      memoryMiB: 400,
      capacityMiB: 1_000,
    }], 60_000, 2_500));
    expect(replacement.status).toBe("prepared");
    (await database.close());
  });

  it("recovers interrupted operations and schedules active deployments for repair", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const store = new MeshStore(database);
    (await addModel(store, "qwen"));
    const firstController = new DeploymentControlPlane(store, "controller-before-crash");
    (await firstController.initialize(1_000));
    const operation = (await firstController.claimOperation("qwen", "activate", {
      now: 2_000,
      leaseMs: 60_000,
    }))!;
    (await firstController.prepareRoute(operation.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 10,
      memoryMiB: 512,
      capacityMiB: 1_024,
    }], 1_000, 2_000));

    const recovered = new DeploymentControlPlane(store, "controller-after-crash");
    expect((await recovered.initialize(4_000))).toEqual({
      models: 1,
      interruptedOperations: 1,
      expiredReservations: 1,
    });
    expect((await recovered.getOperation(operation.id))).toMatchObject({
      status: "interrupted",
      errorCode: "coordinator_restarted",
    });
    expect((await recovered.getState("qwen"))).toMatchObject({
      desiredState: "active",
      observedState: "degraded",
      nextRetryAt: 4_000,
      activeOperationId: null,
    });
    expect((await recovered.listDueStates(4_000)).map((state) => state.modelId)).toEqual(["qwen"]);
    (await database.close());
  });

  it("persists retry scheduling rather than keeping it only in process memory", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const store = new MeshStore(database);
    (await addModel(store, "qwen"));
    const controller = new DeploymentControlPlane(store, "controller-a");
    (await controller.initialize(1_000));
    const operation = (await controller.claimOperation("qwen", "activate", { now: 2_000 }))!;

    expect((await controller.failOperation(
      operation.id,
      "worker_disconnected",
      "node-a disconnected",
      { retryAt: 12_000, now: 3_000 },
    ))).toBe(true);
    expect((await controller.getState("qwen"))).toMatchObject({
      observedState: "failed",
      retryCount: 1,
      nextRetryAt: 12_000,
      lastError: "node-a disconnected",
    });
    expect((await controller.listDueStates(11_999))).toEqual([]);
    expect((await controller.listDueStates(12_000))).toHaveLength(1);
    (await database.close());
  });

  it("releases every prepared stage lease immediately when activation fails", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const store = new MeshStore(database);
    (await addModel(store, "failed-route"));
    (await addModel(store, "replacement-route"));
    const controller = new DeploymentControlPlane(store, "controller-a");
    (await controller.initialize(1_000));
    const failed = (await controller.claimOperation("failed-route", "activate", { now: 2_000 }))!;
    const reservation = (await controller.prepareRoute(failed.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 8,
      memoryMiB: 900,
      capacityMiB: 1_000,
    }], 60_000, 2_100));

    expect((await controller.failOperation(
      failed.id,
      "launch_failed",
      "downstream stage did not become ready",
      { now: 2_200 },
    ))).toBe(true);
    expect((await controller.getReservation(reservation.id))).toMatchObject({
      status: "failed",
      error: "downstream stage did not become ready",
      releasedAt: 2_200,
    });

    const replacement = (await controller.claimOperation("replacement-route", "activate", { now: 2_300 }))!;
    expect((await controller.prepareRoute(replacement.id, [{
      nodeId: "node-a",
      stageIndex: 0,
      layerStart: 0,
      layerEnd: 8,
      memoryMiB: 900,
      capacityMiB: 1_000,
    }], 60_000, 2_400)).status).toBe("prepared");
    (await database.close());
  });
});

async function addModel(store: MeshStore, id: string) {
  return (await store.upsertRequestedModel({
    id,
    source: `test/${id}`,
    revision: null,
    contextTokens: 4_096,
    minimumNodes: 1,
    autoActivate: true,
  }));
}
