import { z } from "zod";
import { sha256CanonicalEvidence } from "../core/json.js";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
const sample = z.object({
  jobId: id, receiptId: digest, traceDigest: digest, resultDigest: digest,
  inputTokens: z.number().int().positive().safe(), outputTokens: z.literal(0),
  completedAt: z.number().int().nonnegative().safe(),
}).strict();
const body = z.object({
  schema: z.literal("mycellios-native-replica-qualification/1"),
  workerId: id, sessionId: id, deploymentId: id, activationId: id,
  model: id, modelDigest: digest, buildSourceId: digest, physicalNodeId: id,
  responseKind: z.enum(["embedding", "speech"]), challengeId: id, promptDigest: digest,
  issuedAt: z.number().int().nonnegative().safe(), observedAt: z.number().int().nonnegative().safe(),
  samples: z.array(sample).length(3),
}).strict().superRefine((value, context) => {
  if (value.observedAt < value.issuedAt || value.observedAt - value.issuedAt > 600_000
    || new Set(value.samples.map(s => s.jobId)).size !== 3
    || new Set(value.samples.map(s => s.receiptId)).size !== 3
    || value.samples.some(s => s.completedAt < value.issuedAt || s.completedAt > value.observedAt)) {
    context.addIssue({ code: "custom", message: "native_replica_sample_binding_is_invalid" });
  }
});
export type NativeReplicaEvidenceInput = z.infer<typeof body>;
export const nativeReplicaEvidenceSchema = body.safeExtend({ evidenceId: digest }).superRefine((value, context) => {
  const { evidenceId, ...unsigned } = value;
  if (sha256CanonicalEvidence(unsigned) !== evidenceId) {
    context.addIssue({ code: "custom", message: "native_replica_evidence_integrity_is_invalid" });
  }
});
export type NativeReplicaEvidence = z.infer<typeof nativeReplicaEvidenceSchema>;

/** Coordinator-only construction, following completed authenticated public job leases. */
export function createNativeReplicaEvidence(value: NativeReplicaEvidenceInput): NativeReplicaEvidence {
  const normalized = body.parse(value);
  return nativeReplicaEvidenceSchema.parse({ ...normalized, evidenceId: sha256CanonicalEvidence(normalized) });
}
