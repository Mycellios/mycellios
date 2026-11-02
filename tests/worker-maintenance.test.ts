import { describe, expect, it, vi } from "vitest";
import { WorkerMaintenance } from "../src/coordinator/worker-maintenance.js";
import { WorkerHub } from "../src/coordinator/worker-hub.js";
import type { MeshStore, StoredWorker } from "../src/storage/store.js";
import type { WorkerStatus } from "../src/contracts/types.js";

function setup() {
  const worker = { id: "worker", status: "online" as WorkerStatus } as StoredWorker;
  const store: Pick<MeshStore, "getWorker" | "setWorkerStatus"> = {
    getWorker: () => worker, setWorkerStatus: (_id, status) => { worker.status = status; },
  };
  return { worker, store, maintenance: new WorkerMaintenance() };
}
describe("bounded worker maintenance", () => {
  it("blocks lease offers at the actual send boundary while allowing cancellation of existing jobs", async () => {
    const f = setup(); await f.maintenance.set("worker", true, f.store, true);
    const sendSocket = vi.fn(() => true);
    const harness = { maintenance: f.maintenance, connections: new Map([["worker", { ready: true, socket: { OPEN: 1, readyState: 1 } }]]), sendSocket };
    expect(WorkerHub.prototype.send.call(harness as unknown as WorkerHub, "worker", "lease.offer", {})).toBe(false);
    expect(sendSocket).not.toHaveBeenCalled();
    expect(WorkerHub.prototype.send.call(harness as unknown as WorkerHub, "worker", "task.cancel", { jobId: "existing" })).toBe(true);
    expect(f.worker.status).toBe("draining");
  });
  it("does not let heartbeats undo maintenance, and preserves owner pause on release", async () => {
    const f = setup(); await f.maintenance.set("worker", true, f.store, true);
    expect(f.maintenance.status("worker", "online")).toBe("draining");
    expect(f.maintenance.status("worker", "draining")).toBe("draining");
    await f.maintenance.set("worker", false, f.store, true);
    expect(f.worker.status).toBe("draining"); expect(f.maintenance.blocked("worker")).toBe(false);
  });
  it("does not mark a disconnected worker online when releasing maintenance", async () => {
    const f = setup(); await f.maintenance.set("worker", true, f.store, true); f.worker.status = "offline";
    await f.maintenance.set("worker", false, f.store, false);
    expect(f.worker.status).toBe("offline"); expect(f.maintenance.blocked("worker")).toBe(false);
  });
});
