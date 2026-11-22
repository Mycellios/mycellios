import { z } from "zod";

/**
 * The Mycellios API subscription (Mycellios Go) and the requests made with the
 * account's own API keys. They are separate from Agent's own billing and Mico usage.
 * The Agent server reads them with the user's own Mycellios session; the browser
 * never receives that session token.
 */
const ExpectedUserId = z.string().min(1).max(128);

export const MycelliosApiPlanSchema = z.object({
  checkoutAvailable: z.boolean(),
  portalAvailable: z.boolean(),
  tokenDebt: z.number().int().nonnegative(),
  /** API token balance, or null when the account read failed. Never a default zero. */
  tokenBalance: z.number().int().nullable(),
  plan: z
    .object({
      currency: z.string().min(3).max(3),
      amountMicros: z.number().int().nonnegative(),
      includedTokens: z.number().int().nonnegative(),
      status: z.enum(["draft", "active", "retired"]),
    })
    .nullable(),
  subscription: z
    .object({
      status: z.enum(["active", "past_due", "cancelled"]),
      periodEnd: z.number().int(),
    })
    .nullable(),
});
export type MycelliosApiPlan = z.infer<typeof MycelliosApiPlanSchema>;

export const MycelliosApiUsageEntrySchema = z.object({
  id: z.string().min(1).max(200),
  model: z.string().max(300),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  status: z.enum(["pending", "completed", "failed"]),
  createdAt: z.string().max(64),
});
export type MycelliosApiUsageEntry = z.infer<typeof MycelliosApiUsageEntrySchema>;

export const MycelliosApiUsageSchema = z.object({
  /** Lifetime totals, or null when the account read failed. */
  totals: z
    .object({
      requestCount: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .nullable(),
  /** The newest requests, at most MYCELLIOS_API_USAGE_LIMIT. */
  requests: z.array(MycelliosApiUsageEntrySchema),
});
export type MycelliosApiUsage = z.infer<typeof MycelliosApiUsageSchema>;

export const MYCELLIOS_API_USAGE_LIMIT = 50;

export const MycelliosApiReadInput = z.object({ expectedUserId: ExpectedUserId }).strict();

/**
 * The browser keeps one key per intent and reuses it on retries, so an uncertain
 * request cannot open a second checkout or portal session.
 */
export const MycelliosApiBillingKey = (kind: "subscription" | "portal") =>
  z.string().regex(new RegExp(`^mycellios-${kind}-[A-Za-z0-9-]{8,96}$`));

export const MycelliosApiCheckoutInput = z
  .object({ expectedUserId: ExpectedUserId, idempotencyKey: MycelliosApiBillingKey("subscription") })
  .strict();
export const MycelliosApiPortalInput = z
  .object({ expectedUserId: ExpectedUserId, idempotencyKey: MycelliosApiBillingKey("portal") })
  .strict();

export const MycelliosApiRedirectSchema = z.object({ url: z.string().url().max(4096) });
export type MycelliosApiRedirect = z.infer<typeof MycelliosApiRedirectSchema>;

/** Only Stripe's own hosted Checkout or customer portal, over HTTPS without credentials. */
export function isStripeRedirect(value: string, kind: "checkout" | "portal"): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const expected = kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com";
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    (url.hostname === expected || url.hostname.endsWith(`.${expected}`))
  );
}
