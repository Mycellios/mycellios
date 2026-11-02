import type { ModelActivationManager } from "./model-activation-manager.js";
import type { WorkerHub, WorkerDisconnectDetails } from "./worker-hub.js";
import { WarmRouteRecovery } from "./warm-route-recovery.js";

/** Capture before MeshService's synchronous disconnect consequences. The normal
 * admission path still rejects disconnected dependencies and failed jobs stay failed. */
export class InferenceRouteRecovery {
  private readonly warm: WarmRouteRecovery;
  private readonly detachCapture: () => void;
  private closed = false;
  constructor(private readonly hub: WorkerHub, manager: ModelActivationManager | undefined,
    dependencies: (workerId: string, disconnectedNodeId?: string) => string[] | Promise<string[]>,
    private readonly repair: (modelId: string, reason: string) => void,
    bounds?: { windowMs?: number; pollMs?: number }) {
    this.warm = new WarmRouteRecovery(repair, bounds);
    const capture = async (workerId: string, details?: WorkerDisconnectDetails) => {
      const models = await dependencies(workerId, details?.nodeId);
      if (this.closed) return;
      for (const model of models) {
        if (details?.recoverable !== true) { this.warm.cancelModel(model); continue; }
        const lease = manager?.recoveryLeaseForModel?.(model);
        if (lease) this.warm.request(model, `pipeline_stage_disconnected:${workerId}`, lease);
      }
    };
    this.detachCapture = hub.beforeDisconnect(capture);
  }
  requestRepair(model: string, reason: string): void {
    if (!this.warm.hasPending(model)) this.repair(model, reason);
  }
  close(): void {
    this.closed = true;
    this.detachCapture();
    this.warm.close();
  }
}
