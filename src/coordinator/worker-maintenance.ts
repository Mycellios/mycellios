import type { MeshStore } from "../storage/store.js";
import type { WorkerStatus } from "../contracts/types.js";

/** Stops new lease offers while retaining existing jobs and the worker's own pause state. */
export class WorkerMaintenance {
  private readonly states = new Map<string, { reported: WorkerStatus }>();
  blocked(workerId: string): boolean { return this.states.has(workerId); }
  status(workerId: string, reported: WorkerStatus): WorkerStatus {
    const state = this.states.get(workerId);
    if (!state) return reported;
    state.reported = reported;
    return "draining";
  }
  async set(workerId: string, enabled: boolean, store: Pick<MeshStore, "getWorker" | "setWorkerStatus">, connected: boolean): Promise<void> {
    const worker = await store.getWorker(workerId);
    if (!worker) throw Object.assign(new Error("worker_not_found"), { statusCode: 404 });
    if (enabled) {
      if (!connected) throw Object.assign(new Error("worker_not_connected"), { statusCode: 409 });
      const previous = this.states.get(workerId);
      this.states.set(workerId, previous ?? { reported: worker.status });
      try { await store.setWorkerStatus(workerId, "draining"); }
      catch (error) { if (!previous) this.states.delete(workerId); throw error; }
    } else {
      const state = this.states.get(workerId);
      if (!state) return;
      if (connected) await store.setWorkerStatus(workerId, state.reported);
      this.states.delete(workerId);
    }
  }
}
