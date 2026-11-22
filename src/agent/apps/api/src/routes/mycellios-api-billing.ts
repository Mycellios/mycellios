import { ORPCError } from "@orpc/server";
import { isStripeRedirect, MYCELLIOS_API_USAGE_LIMIT, type MycelliosApiPlan } from "@mycellios/contracts";
import * as z from "zod";
import type { RouterContext } from "./context.js";
import { mycelliosSessionUpstream } from "./mycellios-session-upstream.js";

const SMALL_RESPONSE_BYTES = 32 * 1024;
const USAGE_RESPONSE_BYTES = 256 * 1024;

const tokens = z.number().int().nonnegative();
const UpstreamBillingAccount = z.object({
  checkoutAvailable: z.boolean(),
  portalAvailable: z.boolean(),
  tokenDebt: tokens,
  plan: z
    .object({
      currency: z.string().min(3).max(3),
      amountMicros: tokens,
      includedTokens: tokens,
      status: z.enum(["draft", "active", "retired"]),
    })
    .nullable(),
  subscription: z
    .object({ status: z.enum(["active", "past_due", "cancelled"]), periodEnd: z.number().int() })
    .nullable(),
});
const UpstreamApiAccount = z.object({
  token_balance: z.number().int(),
  lifetime_input_tokens: tokens,
  lifetime_output_tokens: tokens,
  request_count: tokens,
});
const UpstreamUsage = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        model: z.string().max(300),
        input_tokens: tokens,
        output_tokens: tokens,
        total_tokens: tokens,
        status: z.enum(["pending", "completed", "failed"]),
        created_at: z.string().max(64),
      }),
    )
    .max(MYCELLIOS_API_USAGE_LIMIT),
});
const UpstreamRedirect = z.object({ url: z.string().max(4096) });

/**
 * The Mycellios API subscription (Mycellios Go) and API-key usage of the signed-in
 * account, through the same coordinator endpoints the dashboard used. Checkout and
 * the portal keep the coordinator's own plan, customer and idempotency checks; the
 * browser's key is forwarded unchanged so a retry never opens a second session, and
 * only Stripe-hosted destinations are returned. Return URLs stay coordinator-owned.
 */
export function mycelliosApiBillingRoutes({ authed, deps }: RouterContext) {
  const { sessionToken, json, ownedBy } = mycelliosSessionUpstream(deps);

  async function account(token: string, signal?: AbortSignal) {
    try {
      return await json(token, "/account", { method: "GET" }, UpstreamApiAccount, SMALL_RESPONSE_BYTES, signal);
    } catch (error) {
      // A missing balance is shown as unavailable, never as zero; session failures still surface.
      if (error instanceof ORPCError && error.code === "UNAUTHORIZED") throw error;
      return null;
    }
  }

  async function redirect(
    token: string,
    path: string,
    kind: "checkout" | "portal",
    idempotencyKey: string,
    signal?: AbortSignal,
  ) {
    const { url } = await json(
      token,
      path,
      { method: "POST", body: "{}", headers: { "idempotency-key": idempotencyKey } },
      UpstreamRedirect,
      SMALL_RESPONSE_BYTES,
      signal,
    );
    if (!isStripeRedirect(url, kind)) throw new ORPCError("SERVICE_UNAVAILABLE");
    return { url: new URL(url).toString() };
  }

  return {
    mycelliosApiBilling: {
      plan: authed.mycelliosApiBilling.plan.handler(async ({ context, input }): Promise<MycelliosApiPlan> => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const [billing, balance] = await Promise.all([
          json(token, "/billing/account", { method: "GET" }, UpstreamBillingAccount, SMALL_RESPONSE_BYTES, context.signal),
          account(token, context.signal),
        ]);
        return { ...billing, tokenBalance: balance?.token_balance ?? null };
      }),
      usage: authed.mycelliosApiBilling.usage.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const [usage, totals] = await Promise.all([
          json(
            token,
            `/account/usage?limit=${MYCELLIOS_API_USAGE_LIMIT}`,
            { method: "GET" },
            UpstreamUsage,
            USAGE_RESPONSE_BYTES,
            context.signal,
          ),
          account(token, context.signal),
        ]);
        return {
          totals: totals
            ? {
                requestCount: totals.request_count,
                inputTokens: totals.lifetime_input_tokens,
                outputTokens: totals.lifetime_output_tokens,
              }
            : null,
          requests: usage.data.map((entry) => ({
            id: entry.id,
            model: entry.model,
            inputTokens: entry.input_tokens,
            outputTokens: entry.output_tokens,
            totalTokens: entry.total_tokens,
            status: entry.status,
            createdAt: entry.created_at,
          })),
        };
      }),
      checkout: authed.mycelliosApiBilling.checkout.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        return redirect(token, "/billing/checkout/subscription", "checkout", input.idempotencyKey, context.signal);
      }),
      portal: authed.mycelliosApiBilling.portal.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        return redirect(token, "/billing/portal", "portal", input.idempotencyKey, context.signal);
      }),
    },
  };
}
