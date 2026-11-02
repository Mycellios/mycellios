import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

describe("stable worker identity", () => {
  let database: MeshDatabase;
  let store: MeshStore;

  beforeEach(async () => {
    database = (await MeshDatabase.open(":memory:"));
    store = new MeshStore(database);
  });

  afterEach(async () => (await database.close()));

  it("reuses and reactivates the same worker row for a native device", async () => {
    const identity = { kind: "device" as const, id: "desktop-stable-test" };
    const first = (await addWorker(store, { id: "first", identity, offeredVramMb: 4_096 }));
    expect((await store.deregisterWorker(first.id))).toBe(true);

    const second = (await addWorker(store, { id: "second", identity, offeredVramMb: 6_144 }));

    expect(second.id).toBe(first.id);
    expect(second.identityKind).toBe("device");
    expect(second.identityId).toBe(identity.id);
    expect(second.capabilities.gpus[0]?.offeredVramMb).toBe(6_144);
    expect((await store.listWorkers())).toHaveLength(1);
  });

  it("does not mark a connected worker offline when it republishes capabilities", async () => {
    const identity = { kind: "device" as const, id: "desktop-live-refresh" };
    const first = (await addWorker(store, { id: "first", identity, offeredVramMb: 4_096 }));
    expect(first.status).toBe("online");

    const refreshed = (await addWorker(store, { id: "second", identity, offeredVramMb: 6_144 }));

    expect(refreshed.id).toBe(first.id);
    expect(refreshed.status).toBe("online");
    expect(refreshed.capabilities.gpus[0]?.offeredVramMb).toBe(6_144);
  });

  it("keeps independently identified cells separate from physical devices", async () => {
    const device = (await addWorker(store, {
      id: "device",
      identity: { kind: "device", id: "shared-name" },
    }));
    const cell = (await addWorker(store, {
      id: "cell",
      identity: { kind: "cell", id: "shared-name" },
    }));

    expect(cell.id).not.toBe(device.id);
    expect((await store.listWorkers())).toHaveLength(2);
  });
});
