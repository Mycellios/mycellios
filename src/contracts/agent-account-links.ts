/**
 * Account management lives in Mycellios Agent. The public dashboard and landing
 * link to these fixed Agent settings sections instead of keeping their own copies.
 */
export const AGENT_ORIGIN = "https://www.mycellios.com";
export const AGENT_API_KEYS_URL = `${AGENT_ORIGIN}/agent/app?settings=api-keys`;
export const AGENT_ACCOUNT_URL = `${AGENT_ORIGIN}/agent/app?settings=profile`;

/**
 * Where a legacy dashboard account link now lives, or null when the dashboard still
 * serves it. `/account?tab=api` moved to the Agent account's API keys section.
 */
export function legacyAccountRedirect(pathname: string, search: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/account") return null;
  return new URLSearchParams(search).get("tab") === "api" ? AGENT_API_KEYS_URL : null;
}
