import * as z from "zod";

export const PlanLimitWindowSchema = z.object({
  id: z.string().max(160),
  label: z.string().max(160),
  durationMinutes: z.number().finite().positive().nullable(),
  usedPercent: z.number().finite().nonnegative(),
  resetsAt: z.string().datetime().nullable(),
  /** Null denotes the whole account; model-specific buckets stay separately labelled. */
  model: z.string().max(160).nullable(),
});
export type PlanLimitWindow = z.infer<typeof PlanLimitWindowSchema>;
export const PlanLimitStatusSchema = z.enum([
  "available",
  "unsupported",
  "unavailable",
  "reconnect",
  "rate_limited",
]);
export const AccountPlanLimitSchema = z.object({
  credentialId: z.string(),
  provider: z.string(),
  label: z.string(),
  authKind: z.enum(["oauth", "api_key", "openai_compatible", "unknown"]),
  plan: z.string().max(160).nullable(),
  status: PlanLimitStatusSchema,
  windows: z.array(PlanLimitWindowSchema).max(32),
  checkedAt: z.string().datetime(),
  measuredAt: z.string().datetime().nullable(),
  retryAt: z.string().datetime().nullable(),
  /** Safe stable reason; never forward vendor response bodies or credentials. */
  reason: z
    .enum([
      "not_reported",
      "unreachable",
      "invalid_response",
      "expired",
      "permission",
      "rate_limit",
      "secret_unavailable",
      "timeout",
    ])
    .nullable(),
});
export type AccountPlanLimit = z.infer<typeof AccountPlanLimitSchema>;
export const AccountPlanLimitsSchema = z.object({
  accounts: z.array(AccountPlanLimitSchema),
  checkedAt: z.string().datetime(),
});
export type AccountPlanLimits = z.infer<typeof AccountPlanLimitsSchema>;
