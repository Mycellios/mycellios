import type { AuthSession, PublicAuthConfig } from "./auth";

export interface OAuthAuthorization {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string };
  scope: string;
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
  if (!response.ok) throw new Error("This authorization is unavailable or has expired.");
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
