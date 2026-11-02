import type { OAuthAuthorization } from "./oauth-consent";

declare const __FIRST_PARTY_CLIENTS_PATH__: string;
export type FirstPartyClient = { clientId: string; redirectUri: string };
const identityScopes = new Set(["openid", "email", "profile"]);

function callback(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return null;
    const hosted =
      url.origin === "https://www.mycellios.com" &&
      url.pathname === "/agent/api/auth/callback/oidc";
    const preview =
      url.origin === "http://127.0.0.1:5188" && url.pathname === "/api/auth/callback/oidc";
    return hosted || preview ? url : null;
  } catch {
    return null;
  }
}

export function parseFirstPartyClients(value: unknown): FirstPartyClient[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Invalid sign-in configuration");
  return value.map((entry) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof entry.clientId !== "string" ||
      !/^[a-z0-9_-]{8,128}$/i.test(entry.clientId) ||
      typeof entry.redirectUri !== "string" ||
      !callback(entry.redirectUri)
    )
      throw new Error("Invalid sign-in configuration");
    return { clientId: entry.clientId, redirectUri: new URL(entry.redirectUri).href };
  });
}

/** Trust the configured client/callback pair and only the existing identity scopes. */
export function isFirstPartyAuthorization(
  details: OAuthAuthorization,
  clients: FirstPartyClient[],
): boolean {
  const scopes = details.scope.trim().split(/\s+/);
  return (
    Boolean(callback(details.redirect_uri)) &&
    scopes.includes("openid") &&
    scopes.every((scope) => identityScopes.has(scope)) &&
    clients.some(
      (client) =>
        client.clientId === details.client.id &&
        client.redirectUri === new URL(details.redirect_uri).href,
    )
  );
}

export function isFirstPartyReturn(value: string, clients: FirstPartyClient[]): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    return clients.some((client) => {
      const expected = new URL(client.redirectUri);
      return url.origin === expected.origin && url.pathname === expected.pathname;
    });
  } catch {
    return false;
  }
}

export async function loadFirstPartyClients(
  path = __FIRST_PARTY_CLIENTS_PATH__,
): Promise<FirstPartyClient[]> {
  if (!/^\/oauth\/consent-assets\/clients-[a-f0-9]{16}\.json$/.test(path))
    throw new Error("Invalid sign-in configuration");
  const response = await fetch(path, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Sign-in configuration unavailable");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 8192) throw new Error("Invalid sign-in configuration");
  return parseFirstPartyClients(JSON.parse(new TextDecoder().decode(bytes)));
}
