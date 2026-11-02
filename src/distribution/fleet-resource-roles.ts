import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(256);
const stamp = z.number().finite().nonnegative();
const resourceSchema = z.object({
  nodeId: identifier,
  connected: z.boolean(),
  enabled: z.boolean(),
  observedAtMs: stamp,
  seed: z.object({
    ready: z.boolean(),
    verifiedBlobSha256s: z.array(digest).max(4096),
    freeTransferSlots: z.number().int().min(0).max(64),
  }).strict().optional(),
}).strict();
const demandSchema = z.object({
  requestId: identifier,
  requesterNodeId: identifier,
  blobSha256: digest,
  sizeBytes: z.number().int().positive().safe(),
  originExpectedMs: z.number().positive().finite(),
  originUncertaintyMs: z.number().nonnegative().finite().optional(),
  peers: z.array(z.object({
    nodeId: identifier,
    measuredAtMs: stamp,
    rttMs: z.number().nonnegative().finite(),
    goodputMbps: z.number().positive().finite(),
    uncertaintyMs: z.number().nonnegative().finite().optional(),
  }).strict()).max(4096),
}).strict();
const evidenceSchema = z.object({
  nodes: z.array(resourceSchema).max(4096),
  demands: z.array(demandSchema).max(4096),
}).strict();

/** Authenticated service observations, not hardware claims or seeding grants. */
export type FleetResourceEvidence = z.infer<typeof evidenceSchema>;
export type FleetResourceRole = "inference" | "artifact-seed" | "available" | "paused" | "unavailable";
export interface FleetResourceAssignment {
  nodeId: string;
  role: FleetResourceRole;
  reason: string;
  transferRequestIds: string[];
}
export interface FleetResourcePlan {
  schema: "mycellios-fleet-resource-roles/1";
  plannedAtMs: number;
  assignments: FleetResourceAssignment[];
  transfers: Array<{
    requestId: string;
    requesterNodeId: string;
    sourceNodeId: string;
    blobSha256: string;
    sizeBytes: number;
    expectedMs: number;
    originExpectedMs: number;
    expectedUpperMs: number;
    originLowerMs: number;
  }>;
}

const fresh = (observed: number, now: number) => now >= observed && now - observed <= 120_000;

/**
 * Keep the selected decoder unchanged. Assign spare peers only to real, faster
 * artifact transfers; no queued or advisory task is represented as completed.
 * In particular a GPU label or unused RAM never proves an executable role.
 */
export function planFleetResourceRoles(
  selectedNodeIds: readonly string[], evidenceValue: FleetResourceEvidence, nowMs = Date.now(),
): FleetResourcePlan {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("fleet_roles_clock_invalid");
  const evidence = evidenceSchema.parse(evidenceValue);
  const nodes = new Map(evidence.nodes.map(node => [node.nodeId, node]));
  const selected = new Set(selectedNodeIds);
  if (nodes.size !== evidence.nodes.length || selected.size !== selectedNodeIds.length
      || selectedNodeIds.some(id => !nodes.has(id))) throw new Error("fleet_roles_identity_invalid");
  const demandIds = new Set(evidence.demands.map(demand => demand.requestId));
  if (demandIds.size !== evidence.demands.length) throw new Error("fleet_roles_duplicate_demand");
  const assignments = evidence.nodes.map((node): FleetResourceAssignment => {
    const live = node.connected && fresh(node.observedAtMs, nowMs);
    if (selected.has(node.nodeId) && (!live || !node.enabled)) {
      throw new Error("fleet_roles_selected_node_unavailable");
    }
    return { nodeId: node.nodeId,
      role: !live ? "unavailable" : !node.enabled ? "paused" : selected.has(node.nodeId) ? "inference" : "available",
      reason: !live ? "offline-or-stale" : !node.enabled ? "contribution-paused"
        : selected.has(node.nodeId) ? "selected-measured-complete-route" : "no-qualified-support-demand",
      transferRequestIds: [] };
  });
  const byId = new Map(assignments.map(assignment => [assignment.nodeId, assignment]));
  const remaining = new Map(evidence.nodes.map(node => [node.nodeId, node.seed?.freeTransferSlots ?? 0]));
  const transfers: FleetResourcePlan["transfers"] = [];
  // Stable ordering makes duplicate caller retries choose the same task sources.
  for (const demand of [...evidence.demands].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    if (new Set(demand.peers.map(peer => peer.nodeId)).size !== demand.peers.length) {
      throw new Error("fleet_roles_duplicate_peer");
    }
    const requester = nodes.get(demand.requesterNodeId);
    if (!requester?.connected || !requester.enabled || !fresh(requester.observedAtMs, nowMs)) continue;
    const candidates = demand.peers.flatMap(peer => {
      const node = nodes.get(peer.nodeId);
      const assignment = byId.get(peer.nodeId);
      if (!node?.seed?.ready || !assignment || selected.has(peer.nodeId)
          || peer.nodeId === demand.requesterNodeId || !["available", "artifact-seed"].includes(assignment.role)
          || !fresh(peer.measuredAtMs, nowMs) || !node.seed.verifiedBlobSha256s.includes(demand.blobSha256)
          || (remaining.get(peer.nodeId) ?? 0) < 1) return [];
      // Measured end-to-end peer goodput already includes link/transport costs.
      const expectedMs = peer.rttMs + demand.sizeBytes * 8 / (peer.goodputMbps * 1000);
      const expectedUpperMs = expectedMs + (peer.uncertaintyMs ?? 0);
      const originLowerMs = demand.originExpectedMs - (demand.originUncertaintyMs ?? 0);
      return Number.isFinite(expectedUpperMs) && expectedUpperMs < originLowerMs
        ? [{ peer, expectedMs, expectedUpperMs, originLowerMs }] : [];
    }).sort((a, b) => a.expectedMs - b.expectedMs || a.peer.nodeId.localeCompare(b.peer.nodeId));
    const chosen = candidates[0];
    if (!chosen) continue;
    remaining.set(chosen.peer.nodeId, remaining.get(chosen.peer.nodeId)! - 1);
    const assignment = byId.get(chosen.peer.nodeId)!;
    assignment.role = "artifact-seed";
    assignment.reason = "verified-spare-peer-faster-than-origin";
    assignment.transferRequestIds.push(demand.requestId);
    transfers.push({ requestId: demand.requestId, requesterNodeId: demand.requesterNodeId,
      sourceNodeId: chosen.peer.nodeId, blobSha256: demand.blobSha256, sizeBytes: demand.sizeBytes,
      expectedMs: chosen.expectedMs, originExpectedMs: demand.originExpectedMs,
      expectedUpperMs: chosen.expectedUpperMs, originLowerMs: chosen.originLowerMs });
  }
  return { schema: "mycellios-fleet-resource-roles/1", plannedAtMs: nowMs,
    assignments: assignments.sort((a, b) => a.nodeId.localeCompare(b.nodeId)), transfers };
}
