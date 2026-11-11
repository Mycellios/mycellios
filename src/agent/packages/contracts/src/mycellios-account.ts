import { z } from "zod";

/** Internal Credits. Historical ledger identifiers and balances remain compatible; not Spore tokens. */
export const MycelliosAccountSchema = z
  .object({
    object: z.literal("economic_account"),
    asset: z.literal("MYC_MICROCREDITS"),
    balanceMicrounits: z.number().int().safe(),
    lifetimeMicrounits: z.number().int().nonnegative().safe(),
    settledJobs: z.number().int().nonnegative().safe(),
    reservedMicrounits: z.number().int().nonnegative().safe().optional(),
    availableMicrounits: z.number().int().nonnegative().safe().optional(),
    promotionalGrantedMicrounits: z.number().int().nonnegative().safe().optional(),
    promotionalExpiredMicrounits: z.number().int().nonnegative().safe().optional(),
    nextPromotionalExpiry: z.number().int().positive().safe().nullable().optional(),
    contributionEarnedMicrounits: z.number().int().nonnegative().safe().optional(),
    contributionFundingSupported: z.boolean().optional(),
    environment: z.enum(["production", "sandbox"]).optional(),
  })
  .refine(
    (value) =>
      value.availableMicrounits === undefined ||
      value.availableMicrounits <= Math.max(0, value.balanceMicrounits),
    "Invalid available credit balance",
  );

export type MycelliosAccount = z.infer<typeof MycelliosAccountSchema>;
