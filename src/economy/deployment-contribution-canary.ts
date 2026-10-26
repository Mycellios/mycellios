import { DEPLOYMENT_CANARY_MAXIMUM_AGE_MS, validateDeploymentCanaryEvidence } from "../contracts/deployment-canary.js";
import { nativeReplicaEvidenceSchema } from "../contracts/native-replica-evidence.js";
import type { ModelDeployment } from "../contracts/types.js";
import type { StoredWorker } from "../storage/store.js";

export function verifiedContributionCanary(input: {
  owner: StoredWorker | undefined; deployment: ModelDeployment | undefined;
  modelDigest: string; physicalNodeId: string; observedUntil: number;
  currentSessionId?: string | null | undefined;
}): string {
  const { owner, deployment, modelDigest, observedUntil } = input;
  if (!owner || deployment?.verificationState !== "verified") throw new Error("economic_contribution_verified_canary_is_missing");
  const native = deployment.nativeReplicaEvidence;
  if (native) {
    const evidence = nativeReplicaEvidenceSchema.parse(native);
    if (!input.currentSessionId || evidence.sessionId !== input.currentSessionId
      || evidence.workerId !== owner.id || evidence.deploymentId !== deployment.deploymentId
      || evidence.model !== deployment.model || evidence.modelDigest !== modelDigest
      || evidence.activationId !== deployment.activationId || evidence.physicalNodeId !== input.physicalNodeId
      || evidence.buildSourceId !== owner.capabilities.buildIdentity?.sourceId
      || (evidence.responseKind === "speech" ? deployment.adapter !== "kokoro" : String(deployment.adapter) !== "embedding")) {
      throw new Error("economic_contribution_canary_binding_is_invalid");
    }
    if (evidence.observedAt > observedUntil || observedUntil - evidence.observedAt > DEPLOYMENT_CANARY_MAXIMUM_AGE_MS) {
      throw new Error("economic_contribution_canary_is_stale");
    }
    return evidence.evidenceId;
  }
  const canary = deployment.canaryEvidence;
  if (!canary) throw new Error("economic_contribution_verified_canary_is_missing");
  validateDeploymentCanaryEvidence(canary);
  if (canary.workerId !== owner.id || canary.modelDigest !== modelDigest
    || canary.model !== deployment.model || canary.activationId !== deployment.activationId) {
    throw new Error("economic_contribution_canary_binding_is_invalid");
  }
  const at = Date.parse(canary.observedAt);
  if (at > observedUntil || observedUntil - at > DEPLOYMENT_CANARY_MAXIMUM_AGE_MS) throw new Error("economic_contribution_canary_is_stale");
  return canary.evidenceId;
}
