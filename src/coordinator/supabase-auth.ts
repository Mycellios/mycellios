import { createHash } from "node:crypto";

const PUBLIC_NETWORK_ID = "00000000-0000-0000-0000-000000000001";
/** A verified account identity is reused at most this long, and never past the token's own expiry. */
export const AUTHENTICATION_CACHE_TTL_MS = 60_000;
const AUTHENTICATION_CACHE_ENTRIES = 2_000;

export interface SupabaseAuthCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export type NetworkRole = "owner" | "admin" | "operator" | "viewer";

export interface AuthenticatedNetworkUser {
  id: string;
  email: string | null;
  role: NetworkRole | null;
  emailVerified?: boolean;
}

export class SupabaseAuthService {
  private readonly baseUrl: URL;
  private readonly verified = new Map<string, { user: AuthenticatedNetworkUser; expiresAt: number }>();
  private readonly pending = new Map<string, Promise<AuthenticatedNetworkUser | null>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(
    url: string,
    private readonly serviceRoleKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly trustedOAuthClientIds: readonly string[] = [],
    private readonly trustedOAuthIssuer?: string,
    cache: SupabaseAuthCacheOptions = {},
  ) {
    this.baseUrl = new URL(url);
    this.ttlMs = Math.max(0, cache.ttlMs ?? AUTHENTICATION_CACHE_TTL_MS);
    this.maxEntries = Math.max(1, cache.maxEntries ?? AUTHENTICATION_CACHE_ENTRIES);
    this.now = cache.now ?? Date.now;
  }

  async authenticate(accessToken: string): Promise<AuthenticatedNetworkUser | null> {
    // Keyed by digest so the map never holds a bearer token.
    const key = createHash("sha256").update(accessToken).digest("hex");
    const hit = this.verified.get(key);
    if (hit) {
      if (hit.expiresAt > this.now()) return { ...hit.user };
      this.verified.delete(key);
    }
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight.then(user => user && { ...user });
    const verification = this.verify(accessToken).then(user => {
      this.remember(key, accessToken, user);
      return user;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, verification);
    return verification.then(user => user && { ...user });
  }

  private remember(key: string, accessToken: string, user: AuthenticatedNetworkUser | null): void {
    // Rejections, failures and network roles are always verified again: only a
    // plain account identity is reused, so role changes take effect at once.
    if (!user || user.role !== null || this.ttlMs === 0) return;
    const now = this.now();
    const exp = unverifiedClaims(accessToken)?.exp;
    const expiresAt = Math.min(now + this.ttlMs, typeof exp === "number" ? exp * 1_000 : Infinity);
    if (expiresAt <= now) return;
    for (const [stored, entry] of this.verified) if (entry.expiresAt <= now) this.verified.delete(stored);
    while (this.verified.size >= this.maxEntries) this.verified.delete(this.verified.keys().next().value!);
    this.verified.set(key, { user: { ...user }, expiresAt });
  }

  private async verify(accessToken: string): Promise<AuthenticatedNetworkUser | null> {
    // Tokens from the pinned OAuth authority are not Supabase sessions, so asking
    // Supabase first only adds a round trip that always answers 401.
    const pinnedOAuth = this.isTrustedOAuthToken(accessToken);
    if (pinnedOAuth) {
      const user = await this.authenticateOAuth(accessToken);
      if (user) return user;
    }
    const userResponse = await this.fetchImpl(new URL("/auth/v1/user", this.baseUrl), {
      method: "GET",
      signal: AbortSignal.timeout(10_000),
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${accessToken}`,
      },
    });
    if (userResponse.status === 401 || userResponse.status === 403)
      return pinnedOAuth ? null : this.authenticateOAuth(accessToken);
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

  private isTrustedOAuthToken(accessToken: string): boolean {
    if (!this.trustedOAuthIssuer || accessToken.length > 16_384) return false;
    const claims = unverifiedClaims(accessToken);
    // Unverified claims only select the pinned authority, never the identity.
    return claims?.iss === this.trustedOAuthIssuer && typeof claims.client_id === "string"
      && this.trustedOAuthClientIds.includes(claims.client_id);
  }

  private async authenticateOAuth(accessToken: string): Promise<AuthenticatedNetworkUser | null> {
    if (!this.trustedOAuthIssuer || !this.isTrustedOAuthToken(accessToken)) return null;
    const claims = unverifiedClaims(accessToken)!;
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

function unverifiedClaims(accessToken: string): Record<string, unknown> | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString());
    return claims && typeof claims === "object" && !Array.isArray(claims) ? claims as Record<string, unknown> : null;
  } catch { return null; }
}

function isNetworkRole(value: unknown): value is NetworkRole {
  return value === "owner" || value === "admin" || value === "operator" || value === "viewer";
}
