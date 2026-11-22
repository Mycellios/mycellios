import type { InferenceAdapter } from "../adapters/base.js";
import type { ModelDeployment } from "../contracts/types.js";

/**
 * An optional native replica that a paired node runs beside its distributed
 * executor (specs/memory-embedding-qwen06/spec.md, "Automatic node
 * replicas"). The node's own WorkerAgent advertises the slot's deployments
 * under its device identity and routes leases for them to the slot's adapter,
 * so owner scoping, sealed leases, sessions and build identity are the node's.
 */
export interface NativeReplicaSlot {
  /** Deployments to advertise right now; empty while the replica is not ready. */
  deployments(): ModelDeployment[];
  /** The adapter that serves exactly this model and artifact, or null. */
  adapterFor(model: string, modelDigest: string): InferenceAdapter | null;
  cancel(jobId: string): Promise<void>;
}
