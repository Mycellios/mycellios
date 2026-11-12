import { ORPCError } from "@orpc/server";
import { productBrand, ReferralInviteSchema, ReferralRedemptionSchema } from "@rakazo/contracts";
import { readBoundedJsonResponse } from "@rakazo/core";
import type { RouterContext } from "./context.js";

const COOKIE = "mycellios_referral_v1";
/** Never accepts a referrer, beneficiary, amount, URL or receipt from browser JSON. */
export function referralRoutes({ authed, deps }: RouterContext) {
  async function request(path: "invite" | "redeem", headers: Headers, userId: string, signal?: AbortSignal, receipt?: string) {
    if (!deps.env.mycelliosSso) throw new ORPCError("PRECONDITION_FAILED", { message: "Sign in with Mycellios to use referral rewards." });
    const token = await deps.auth.oidcAccessToken(headers, userId);
    if (!token) throw new ORPCError("UNAUTHORIZED");
    const response = await (deps.modelConnectionFetch ?? fetch)(`${productBrand.apiBaseUrl}/referrals/${path}`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
      headers: { authorization: `Bearer ${token}`, ...(receipt ? { "x-mycellios-referral-visit": receipt } : {}) },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ORPCError(response.status === 403 ? "FORBIDDEN" : "SERVICE_UNAVAILABLE", {
        message: response.status === 403 ? "Verify your Mycellios email to use referrals." : "Referral rewards are temporarily unavailable. No reward has been lost.",
      });
    }
    return readBoundedJsonResponse<unknown>(response, 8192, signal);
  }
  return { referrals: {
    invite: authed.referrals.invite.handler(async ({ context, input }) => {
      if (input.expectedUserId !== context.actor.userId || !context.requestHeaders) throw new ORPCError("FORBIDDEN");
      const invite = ReferralInviteSchema.parse(await request("invite", context.requestHeaders, context.actor.userId, context.signal));
      if (new URL(invite.link).origin !== new URL(productBrand.apiBaseUrl).origin ||
          new URL(invite.link).pathname !== `/v1/referrals/visit/${invite.code}`) throw new ORPCError("BAD_GATEWAY");
      return invite;
    }),
    redeem: authed.referrals.redeem.handler(async ({ context, input }) => {
      if (input.expectedUserId !== context.actor.userId || !context.requestHeaders) throw new ORPCError("FORBIDDEN");
      const cookies = (context.requestHeaders.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(COOKIE + "="));
      const receipt = cookies.length === 1 ? cookies[0]!.slice(COOKIE.length + 1) : undefined;
      const validReceipt = receipt && /^[A-Za-z0-9_-]{43}$/.test(receipt) ? receipt : undefined;
      if (!deps.env.mycelliosSso && !validReceipt) return { status: "no_referral" as const };
      return ReferralRedemptionSchema.parse(await request("redeem", context.requestHeaders, context.actor.userId, context.signal, validReceipt));
    }),
  } };
}
