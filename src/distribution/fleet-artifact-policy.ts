import type { FleetResourcePlan } from "./fleet-resource-roles.js";

/** Plug into the verified artifact downloader; the plan never bypasses hashing. */
export function fleetArtifactPeerPolicy(
  plan: FleetResourcePlan, requesterNodeId: string, now: () => number = Date.now,
): (peerId: string, blobSha256: string) => boolean {
  const snapshot = structuredClone(plan);
  return (peerId, blobSha256) => {
    const clock = now();
    if (!Number.isFinite(clock) || clock < snapshot.plannedAtMs
        || clock - snapshot.plannedAtMs > 120_000) return false;
    const assignment = snapshot.assignments.find(node => node.nodeId === peerId);
    if (assignment?.role !== "artifact-seed") return false;
    return snapshot.transfers.some(transfer => transfer.sourceNodeId === peerId
      && transfer.requesterNodeId === requesterNodeId && transfer.blobSha256 === blobSha256
      && assignment.transferRequestIds.includes(transfer.requestId));
  };
}
