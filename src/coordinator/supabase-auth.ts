const PUBLIC_NETWORK_ID = "00000000-0000-0000-0000-000000000001";

export type NetworkRole = "owner" | "admin" | "operator" | "viewer";

export interface AuthenticatedNetworkUser {
  id: string;
  email: string | null;
  role: NetworkRole | null;
  emailVerified?: boolean;
}

export class SupabaseAuthService {
  private readonly baseUrl: URL;

  constructor(
    url: string,
    private readonly serviceRoleKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly trustedOAuthClientIds: readonly string[] = [],
    private readonly trustedOAuthIssuer?: string,
  ) {
    this.baseUrl = new URL(url);
  }

  async authenticate(accessToken: string): Promise<AuthenticatedNetworkUser | null> {
    const userResponse = await this.fetchImpl(new URL("/auth/v1/user", this.baseUrl), {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (userResponse.status === 401 || userResponse.status === 403)
      return this.authenticateOAuth(accessToken);
    if (!userResponse.ok) {
      throw new Error(`Supabase Auth returned HTTP ${userResponse.status}.`);
    }
    const user = await userResponse.json() as { id?: unknown; email?: unknown; email_confirmed_at?: unknown };
    if (typeof user.id !== "string") return null;
    // Inspect claims only after Auth has verified the bearer. OAuth app tokens
    // must never inherit the account's network administrator role.
    if (accessToken.includes(".")) {
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()); }
      catch { return null; }
      if (claims.client_id !== undefined) {
        if (typeof claims.client_id !== "string" || !this.trustedOAuthClientIds.includes(claims.client_id)) return null;
        return { id: user.id, email: typeof user.email === "string" ? user.email : null, role: null,
          ...(typeof user.email_confirmed_at === "string" && user.email_confirmed_at ? { emailVerified: true } : {}) };
      }
    }
    const roleResponse = await this.fetchImpl(
      new URL(
        `/rest/v1/network_members?network_id=eq.${PUBLIC_NETWORK_ID}`
        + `&user_id=eq.${encodeURIComponent(user.id)}&select=role&limit=1`,
        this.baseUrl,
      ),
      {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
        headers: {
          apikey: this.serviceRoleKey,
          authorization: `Bearer ${this.serviceRoleKey}`,
        },
      },
    );
    if (!roleResponse.ok) {
      throw new Error(`Supabase membership lookup returned HTTP ${roleResponse.status}.`);
    }
    const rows = await roleResponse.json() as Array<{ role?: unknown }>;
    const role = rows[0]?.role;
    return {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      role: isNetworkRole(role) ? role : null,
      ...(typeof user.email_confirmed_at === "string" && user.email_confirmed_at ? { emailVerified: true } : {}),
    };
  }

  private async authenticateOAuth(accessToken: string): Promise<AuthenticatedNetworkUser | null> {
    if (!this.trustedOAuthIssuer || accessToken.length > 16_384 || accessToken.split(".").length !== 3) return null;
    let claims: Record<string, unknown>;
    try { claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString()); }
    catch { return null; }
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
    // Unverified claims only select the pinned authority, never the identity.
    if (claims.iss !== this.trustedOAuthIssuer || typeof claims.client_id !== "string"
      || !this.trustedOAuthClientIds.includes(claims.client_id)) return null;
    const authority = new URL(this.trustedOAuthIssuer);
    if (authority.protocol !== "https:" || authority.username || authority.password
      || authority.search || authority.hash) return null;
    const response = await this.fetchImpl(`${authority.href.replace(/\/$/, "")}/oauth/userinfo`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    });
    if (!response.ok) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 65_536) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    let user: { sub?: unknown; email?: unknown; email_verified?: unknown };
    try { user = JSON.parse(raw) as typeof user; } catch { return null; }
    if (typeof user.sub !== "string" || user.sub !== claims.sub) return null;
    return { id: user.sub, email: typeof user.email === "string" ? user.email : null, role: null,
      ...(user.email_verified === true ? { emailVerified: true } : {}) };
  }
}

function isNetworkRole(value: unknown): value is NetworkRole {
  return value === "owner" || value === "admin" || value === "operator" || value === "viewer";
}
