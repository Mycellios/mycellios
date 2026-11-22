/**
 * Account management lives in Mycellios Agent. The public dashboard and landing
 * link to these fixed Agent settings sections instead of keeping their own copies.
 */
export const AGENT_ORIGIN = "https://www.mycellios.com";
export const AGENT_API_KEYS_URL = `${AGENT_ORIGIN}/agent/app?settings=api-keys`;
export const AGENT_API_PLAN_URL = `${AGENT_ORIGIN}/agent/app?settings=api-plan`;
export const AGENT_API_USAGE_URL = `${AGENT_ORIGIN}/agent/app?settings=api-usage`;
export const AGENT_ACCOUNT_URL = `${AGENT_ORIGIN}/agent/app?settings=profile`;

/** Agent's one-time marker for a Mycellios Go Checkout return (`success` or `cancelled`). */
export const AGENT_API_CHECKOUT_PARAM = "apiCheckout";

/**
 * Where a legacy dashboard account link now lives, or null outside `/account`.
 * `/account` itself opened the API plan, and the coordinator's configured Stripe
 * return URLs (`/account?checkout=…`, the portal's `/account`) still arrive there.
 * Only fixed Agent URLs are produced; the Checkout result is carried over only as
 * one of its two known values, never as arbitrary input.
 */
export function legacyAccountRedirect(pathname: string, search: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/account") return null;
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  if (tab === "api") return AGENT_API_KEYS_URL;
  if (tab === "usage") return AGENT_API_USAGE_URL;
  if (tab === null || tab === "billing" || tab === "plan") {
    const checkout = params.get("checkout");
    return checkout === "success" || checkout === "cancelled"
      ? `${AGENT_API_PLAN_URL}&${AGENT_API_CHECKOUT_PARAM}=${checkout}`
      : AGENT_API_PLAN_URL;
  }
  return AGENT_ACCOUNT_URL;
}
