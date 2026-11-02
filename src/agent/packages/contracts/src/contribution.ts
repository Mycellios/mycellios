import * as z from "zod";

export const ContributionNodeInput = z.object({ nodeId: z.string().min(1).max(128) });
export const ContributionStateSchema = z.object({
  nodeId: z.string(), connected: z.boolean(), enabled: z.boolean().nullable(),
  pending: z.enum(["pause", "resume"]).nullable(), rejected: z.boolean(),
});
export const ContributionEnrollmentSchema = z.object({
  schema: z.literal("mycellios-node-enrollment-bundle/1"),
  coordinatorUrl: z.literal("https://www.mycellios.com"),
  enrollmentId: z.string().uuid(), enrollmentToken: z.string().min(32).max(512),
  nonce: z.string().min(16).max(512), expiresAt: z.string().datetime(),
});

/** Upstream account API validation; route handlers return only the reduced state above. */
export const ContributionOwnerSchema = z.object({ user_id: z.string().min(1).max(256) });
export const ContributionOwnedNodesSchema = z.object({ data: z.array(z.object({
  nodeId: z.string(), status: z.enum(["active", "revoked"]), generation: z.number().int().positive(),
  connected: z.boolean(), observed: z.object({ contributionEnabled: z.boolean() }).passthrough().nullable(),
  commands: z.array(z.object({ type: z.string(), state: z.string() }).passthrough()),
}).passthrough()).max(10_000) });
