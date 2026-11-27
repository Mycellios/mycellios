import type { AuthSession, PublicAuthConfig } from "./auth";

export interface OAuthAuthorization {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string };
  scope: string;
}

/** The authority refused the request; 401/403 mean this browser's session is no longer valid. */
export class OAuthConsentError extends Error {
  constructor(readonly status: number) {
    super("This authorization is unavailable or has expired.");
  }
  get sessionRejected() {
    return this.status === 401 || this.status === 403;
  }
  /** The authorization itself is gone: expired, already used or unknown. */
  get authorizationGone() {
    return this.status === 400 || this.status === 404 || this.status === 410;
  }
}

const RESTART_KEY = "mycellios.consent.restartedAt";
const RESTART_WINDOW_MS = 2 * 60_000;

/**
 * Starts a fresh sign-in from Agent instead of showing an expired authorization
 * (a reloaded tab, the back button or an old tab). At most once per two minutes,
 * so an authority that keeps refusing new authorizations shows the error instead
 * of looping. Returns false when it did not navigate.
 */
export function restartExpiredAuthorization(
  go: (url: string) => void = (url) => location.replace(url),
  now = Date.now(),
): boolean {
  try {
    const last = Number(sessionStorage.getItem(RESTART_KEY));
    if (Number.isFinite(last) && now - last >= 0 && now - last < RESTART_WINDOW_MS) return false;
    sessionStorage.setItem(RESTART_KEY, String(now));
  } catch {
    // Without storage the loop guard cannot hold: keep the explicit button.
    return false;
  }
  go("/agent/sign-in");
  return true;
}

export function authorizationId(search: string): string {
  const values = new URLSearchParams(search).getAll("authorization_id");
  const id = values[0] ?? "";
  if (values.length !== 1 || !/^[a-z0-9_-]{20,128}$/i.test(id))
    throw new Error("Invalid authorization request.");
  return id;
}

export function safeAuthorizationRedirect(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid authorization redirect.");
  return url.href;
}

async function consentRequest(
  config: PublicAuthConfig,
  session: AuthSession,
  id: string,
  action?: "approve" | "deny",
) {
  if (!config.enabled || !config.url || !config.anonKey)
    throw new Error("Mycellios sign-in is unavailable.");
  authorizationId(`authorization_id=${encodeURIComponent(id)}`);
  const response = await fetch(
    new URL(`/agent/auth/v1/oauth/authorizations/${id}${action ? "/consent" : ""}`, config.url),
    {
      method: action ? "POST" : "GET",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${session.accessToken}`,
        "content-type": "application/json",
      },
      ...(action ? { body: JSON.stringify({ action }) } : {}),
    },
  );
  if (!response.ok) throw new OAuthConsentError(response.status);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Invalid authorization response.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 16_384) {
      await reader.cancel();
      throw new Error("Invalid authorization response.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}

export async function getOAuthAuthorization(
  config: PublicAuthConfig,
  session: AuthSession,
  id: string,
): Promise<OAuthAuthorization | { redirectUrl: string }> {
  const data = await consentRequest(config, session, id);
  if (typeof data.redirect_url === "string")
    return { redirectUrl: safeAuthorizationRedirect(data.redirect_url) };
  const client = data.client as Record<string, unknown> | undefined;
  if (
    data.authorization_id !== id ||
    typeof data.redirect_uri !== "string" ||
    typeof client?.id !== "string" ||
    typeof client.name !== "string" ||
    typeof data.scope !== "string"
  )
    throw new Error("Invalid authorization response.");
  safeAuthorizationRedirect(data.redirect_uri);
  return data as unknown as OAuthAuthorization;
}

export async function decideOAuthAuthorization(
  config: PublicAuthConfig,
  session: AuthSession,
  details: OAuthAuthorization,
  action: "approve" | "deny",
) {
  const data = await consentRequest(config, session, details.authorization_id, action);
  if (typeof data.redirect_url !== "string") throw new Error("Invalid authorization response.");
  const next = new URL(safeAuthorizationRedirect(data.redirect_url));
  const expected = new URL(details.redirect_uri);
  if (next.origin !== expected.origin || next.pathname !== expected.pathname)
    throw new Error("Invalid authorization redirect.");
  return next.href;
}
