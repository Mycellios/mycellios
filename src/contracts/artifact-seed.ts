import { createHash } from "node:crypto";
import { z } from "zod";

export const ARTIFACT_SEED_OBSERVATION_SCHEMA = "mycellios-artifact-seed-observation/1" as const;
export const ARTIFACT_SEED_GRANT_SCHEMA = "mycellios-artifact-seed-grant/1" as const;
export const ARTIFACT_SEED_REQUEST_SCHEMA = "mycellios-artifact-seed-request/1" as const;
export const ARTIFACT_SEED_RESPONSE_SCHEMA = "mycellios-artifact-seed-response/1" as const;
/** One request or response header line, including its terminating newline. */
export const ARTIFACT_SEED_MAX_HEADER_BYTES = 1_024;
export const ARTIFACT_SEED_MAX_BLOBS = 4_096;
/** Same validity window as a fleet resource plan. */
export const ARTIFACT_SEED_MAX_GRANT_MS = 120_000;

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const nodeId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const transferId = z.string().min(1).max(256);
/** 32 random bytes, canonical base64url. */
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const demandId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const outcomeCode = z.string().regex(/^artifact_seed_[a-z_]{1,64}$/);

export function artifactSeedInventoryRevision(digests: readonly string[]): string {
  return createHash("sha256").update([...digests].sort().join("\n")).digest("hex");
}

/**
 * Owner-bounded seeding observation. A digest list is a claim used only for
 * eligibility: every byte is re-verified by the requester. The list may be
 * omitted while `inventoryRevision` is unchanged (delta heartbeat); the
 * coordinator then keeps the list it stored for that same revision.
 */
export const artifactSeedObservationSchema = z.object({
  schema: z.literal(ARTIFACT_SEED_OBSERVATION_SCHEMA),
  ready: z.boolean(),
  /** SHA-256 of the newline-joined, sorted advertised digests. */
  inventoryRevision: digest,
  verifiedBlobSha256s: z.array(digest).max(ARTIFACT_SEED_MAX_BLOBS).optional(),
  freeTransferSlots: z.number().int().min(0).max(64),
  quotaBytes: z.number().int().nonnegative().safe(),
  heldBytes: z.number().int().nonnegative().safe(),
  /** Loopback seed port that a coordinator-authorized runtime stream may target. */
  servicePort: z.number().int().min(1).max(65_535).optional(),
  /** Seconds since the epoch, as in host memory observations. */
  observedAt: z.number().nonnegative().finite(),
}).strict().superRefine((value, context) => {
  const list = value.verifiedBlobSha256s;
  if (value.heldBytes > value.quotaBytes) {
    context.addIssue({ code: "custom", path: ["heldBytes"], message: "Held bytes exceed the owner quota" });
  }
  if (list && new Set(list).size !== list.length) {
    context.addIssue({ code: "custom", path: ["verifiedBlobSha256s"], message: "Duplicate blob digest" });
  }
  if (list && artifactSeedInventoryRevision(list) !== value.inventoryRevision) {
    context.addIssue({ code: "custom", path: ["inventoryRevision"], message: "Revision does not match the list" });
  }
  if (!value.ready && ((list?.length ?? 0) > 0 || value.freeTransferSlots > 0)) {
    context.addIssue({ code: "custom", path: ["ready"], message: "An unready seed offers nothing" });
  }
});
export type ArtifactSeedObservation = z.infer<typeof artifactSeedObservationSchema>;

export function isFreshArtifactSeed(observation: ArtifactSeedObservation, nowSeconds: number): boolean {
  const age = nowSeconds - observation.observedAt;
  return Number.isFinite(nowSeconds) && nowSeconds >= 0 && age >= -1 && age <= 120;
}

/** Single-use, short-lived authorization for one planned blob transfer. */
export const artifactSeedGrantSchema = z.object({
  schema: z.literal(ARTIFACT_SEED_GRANT_SCHEMA),
  transferId,
  sourceNodeId: nodeId,
  requesterNodeId: nodeId,
  blobSha256: digest,
  sizeBytes: z.number().int().positive().safe(),
  expiresAtMs: z.number().int().nonnegative().safe(),
  token,
}).strict().refine(value => value.sourceNodeId !== value.requesterNodeId, {
  message: "A node cannot seed itself", path: ["requesterNodeId"],
});
export type ArtifactSeedGrant = z.infer<typeof artifactSeedGrantSchema>;

export const artifactSeedRequestSchema = z.object({
  schema: z.literal(ARTIFACT_SEED_REQUEST_SCHEMA),
  transferId,
  requesterNodeId: nodeId,
  blobSha256: digest,
  token,
}).strict();
export type ArtifactSeedRequest = z.infer<typeof artifactSeedRequestSchema>;

export const artifactSeedResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    schema: z.literal(ARTIFACT_SEED_RESPONSE_SCHEMA),
    ok: z.literal(true),
    blobSha256: digest,
    sizeBytes: z.number().int().positive().safe(),
  }).strict(),
  z.object({
    schema: z.literal(ARTIFACT_SEED_RESPONSE_SCHEMA),
    ok: z.literal(false),
    code: outcomeCode,
  }).strict(),
]);
export type ArtifactSeedResponse = z.infer<typeof artifactSeedResponseSchema>;

/** Worker to coordinator: this requester needs one exact blob for a stage. */
export const artifactSeedDemandPayloadSchema = z.object({
  demandId,
  blobSha256: digest,
  sizeBytes: z.number().int().positive().safe(),
}).strict();
export type ArtifactSeedDemandPayload = z.infer<typeof artifactSeedDemandPayloadSchema>;

/** Worker to coordinator: content-free outcome; ends the grant on both sides. */
export const artifactSeedCompletePayloadSchema = z.object({
  transferId,
  ok: z.boolean(),
  code: outcomeCode.optional(),
}).strict();
export type ArtifactSeedCompletePayload = z.infer<typeof artifactSeedCompletePayloadSchema>;

/** Coordinator to worker messages. A worker sends demands only after `ready`. */
export const artifactSeedServerPayloadSchemas = {
  "artifact.seed.ready": z.object({}).strict(),
  "artifact.seed.grant": z.discriminatedUnion("role", [
    z.object({ role: z.literal("source"), grant: artifactSeedGrantSchema }).strict(),
    z.object({ role: z.literal("requester"), demandId, grant: artifactSeedGrantSchema,
      seedTargetPort: z.number().int().min(1).max(65_535) }).strict(),
  ]),
  "artifact.seed.unavailable": z.object({ demandId, code: outcomeCode }).strict(),
  "artifact.seed.revoke": z.object({ transferIds: z.array(transferId).max(256) }).strict(),
  /** The coordinator authenticated this stream's source session as `requesterNodeId`. */
  "artifact.seed.bind": z.object({
    streamId: z.string().min(1).max(256),
    requesterNodeId: nodeId,
    expiresAtMs: z.number().int().nonnegative().safe(),
  }).strict(),
} as const;
type ServerPayloads = typeof artifactSeedServerPayloadSchemas;
export type ArtifactSeedServerMessage = {
  [K in keyof ServerPayloads]: { type: K; payload: z.infer<ServerPayloads[K]> }
}[keyof ServerPayloads];

/** Owner opt-in; absent means the node neither reports nor serves blobs. */
export const nodeArtifactSeedConfigurationSchema = z.object({
  enabled: z.boolean(),
  diskQuotaMiB: z.number().int().min(1).max(16 * 1024 * 1024),
  maxTransferSlots: z.number().int().min(1).max(4),
  maxUploadMbps: z.number().int().min(1).max(10_000),
  /**
   * Weak contributors: start only the worker connection and seed service.
   * No Python runtime is probed or launched, and no stage is admitted.
   */
  seedOnly: z.boolean().optional(),
}).strict();
export type NodeArtifactSeedConfiguration = z.infer<typeof nodeArtifactSeedConfigurationSchema>;
