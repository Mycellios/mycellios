import { z } from "zod";
export const ReferralOwnerInput = z.object({ expectedUserId: z.string().min(1).max(128) }).strict();
export const ReferralInviteSchema = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{43}$/), link: z.url(),
  rewardMicrounits: z.literal(1_000_000), rewardDays: z.literal(14), rewardedInvites: z.number().int().nonnegative() });
export const ReferralRedemptionSchema = z.object({ status: z.enum(["awarded", "already_awarded", "no_referral", "not_eligible", "verification_required"]),
  rewardMicrounits: z.literal(1_000_000).optional(), expiresAt: z.number().int().positive().optional() });
