import { artifactSeedObservationSchema, isFreshArtifactSeed } from "../contracts/artifact-seed.js";
import type { FleetResourceEvidence } from "../distribution/fleet-resource-roles.js";
import type { StoredWorker } from "../storage/store.js";

const MAX_NODES = 4_096;
const FRESH_MS = 120_000;

export interface FleetResourceEvidenceInput {
  workers: readonly StoredWorker[];
  connectedWorkerIds: ReadonlySet<string>;
  nowMs: number;
  /**
   * Devices of the measured selector. Their connected state is the selector's
   * stricter admission result and is never widened here.
   */
  devices?: ReadonlyArray<{ id: string; connected: boolean }>;
  demands?: FleetResourceEvidence["demands"];
}

/**
 * Build planner evidence from persisted heartbeats. A seed observation is an
 * owner-bounded claim: it makes a node eligible for a measured transfer but
 * never proves possession; the requester re-verifies every byte.
 */
export function collectFleetResourceEvidence(input: FleetResourceEvidenceInput): FleetResourceEvidence {
  if (!Number.isFinite(input.nowMs) || input.nowMs < 0) throw new Error("fleet_evidence_clock_invalid");
  const byNode = new Map<string, StoredWorker>();
  for (const worker of input.workers) {
    const nodeId = worker.capabilities.distributedExecutor?.nodeId;
    if (!nodeId) continue;
    const previous = byNode.get(nodeId);
    // A reconnect can leave an old worker row; prefer the live, newest session.
    if (!previous || rank(worker, input.connectedWorkerIds) > rank(previous, input.connectedWorkerIds)) {
      byNode.set(nodeId, worker);
    }
  }
  const nodes: FleetResourceEvidence["nodes"] = [];
  const seen = new Set<string>();
  for (const device of input.devices ?? []) {
    if (seen.has(device.id)) continue;
    seen.add(device.id);
    const seed = seedEvidence(byNode.get(device.id), input.nowMs);
    nodes.push({ nodeId: device.id, connected: device.connected, enabled: true, observedAtMs: input.nowMs,
      ...(seed ? { seed } : {}) });
  }
  for (const [nodeId, worker] of [...byNode].sort(([a], [b]) => a.localeCompare(b))) {
    if (seen.has(nodeId) || nodes.length >= MAX_NODES) continue;
    seen.add(nodeId);
    const age = input.nowMs - worker.lastSeenAt;
    const connected = input.connectedWorkerIds.has(worker.id) && worker.status !== "offline"
      && age >= 0 && age <= FRESH_MS;
    const seed = seedEvidence(worker, input.nowMs);
    nodes.push({ nodeId, connected, enabled: worker.status === "online",
      observedAtMs: Math.max(0, Math.min(worker.lastSeenAt, input.nowMs)), ...(seed ? { seed } : {}) });
  }
  return { nodes, demands: structuredClone(input.demands ?? []) };
}

function seedEvidence(worker: StoredWorker | undefined, nowMs: number): NonNullable<FleetResourceEvidence["nodes"][number]["seed"]> | undefined {
  const observation = artifactSeedObservationSchema.safeParse(worker?.capabilities.artifactSeed);
  if (!observation.success || !isFreshArtifactSeed(observation.data, nowMs / 1_000)) return undefined;
  return {
    ready: observation.data.ready && worker!.status === "online",
    // A delta observation without a carried-over list offers nothing yet.
    verifiedBlobSha256s: observation.data.verifiedBlobSha256s ?? [],
    freeTransferSlots: Math.min(64, observation.data.freeTransferSlots),
  };
}

function rank(worker: StoredWorker, connected: ReadonlySet<string>): number {
  return (connected.has(worker.id) ? 1e15 : 0) + worker.lastSeenAt;
}
