import { randomBytes } from "node:crypto";
import {
  ARTIFACT_SEED_GRANT_SCHEMA,
  ARTIFACT_SEED_MAX_GRANT_MS,
  artifactSeedGrantSchema,
  type ArtifactSeedGrant,
} from "../contracts/artifact-seed.js";
import { fleetArtifactPeerPolicy } from "./fleet-artifact-policy.js";
import type { FleetResourcePlan } from "./fleet-resource-roles.js";

export interface ArtifactSeedGrantOptions {
  now?: number;
  /** Upper bound per grant; never extends past the plan's validity. */
  ttlMs?: number;
  randomToken?: () => string;
}

/**
 * Turn each planned transfer into one single-use grant for its source and
 * requester. Only transfers the downloader policy would admit are granted.
 */
export function issueArtifactSeedGrants(plan: FleetResourcePlan, options: ArtifactSeedGrantOptions = {}): ArtifactSeedGrant[] {
  const now = options.now ?? Date.now();
  const ttl = Math.min(options.ttlMs ?? 60_000, ARTIFACT_SEED_MAX_GRANT_MS);
  if (!Number.isFinite(now) || !(ttl > 0)) throw new Error("artifact_seed_grant_clock_invalid");
  const planExpiry = plan.plannedAtMs + ARTIFACT_SEED_MAX_GRANT_MS;
  if (now < plan.plannedAtMs || now >= planExpiry) return [];
  const token = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  return plan.transfers.flatMap(transfer => {
    const admitted = fleetArtifactPeerPolicy(plan, transfer.requesterNodeId, () => now);
    if (!admitted(transfer.sourceNodeId, transfer.blobSha256)) return [];
    return [artifactSeedGrantSchema.parse({
      schema: ARTIFACT_SEED_GRANT_SCHEMA,
      transferId: transfer.requestId,
      sourceNodeId: transfer.sourceNodeId,
      requesterNodeId: transfer.requesterNodeId,
      blobSha256: transfer.blobSha256,
      sizeBytes: transfer.sizeBytes,
      expiresAtMs: Math.floor(Math.min(now + ttl, planExpiry)),
      token: token(),
    })];
  });
}
