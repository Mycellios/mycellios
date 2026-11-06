import { expo } from "@better-auth/expo";
import { APIError, createAuthEndpoint } from "better-auth/api";
import type { OidcConfig } from "./oidc.js";

/** First-party deployments may put the IdP and the Agent behind one HTTPS origin. */
export function nativeExpo(oidc?: OidcConfig) {
  const plugin = expo();
  const original = plugin.endpoints.expoAuthorizationProxy;
  return { ...plugin, endpoints: { ...plugin.endpoints,
    expoAuthorizationProxy: createAuthEndpoint(original.path, original.options, async ctx => {
      const invalid = () => new APIError("BAD_REQUEST", { message: "Invalid authorizationURL" });
      let url: URL;
      try { url = new URL(ctx.query.authorizationURL); } catch { throw invalid(); }
      if (url.protocol !== "https:" || url.hash || ctx.query.authorizationURL.includes("#")) throw invalid();
      if (url.origin === new URL(ctx.context.baseURL).origin) {
        if (!validFirstPartyAuthorization(url, ctx.context.baseURL, oidc)) throw invalid();
        // A live server-issued state and nonce bind the narrow same-origin exception.
        const marker = await ctx.context.internalAdapter.findVerificationValue(
          `oidc-callback-${url.searchParams.get("state")}`,
        );
        if (!marker || marker.expiresAt.getTime() <= Date.now() || marker.value !== url.searchParams.get("nonce"))
          throw invalid();
      }
      const { oauthState } = ctx.query;
      if (oauthState) {
        if (oauthState.length > 8192) throw invalid();
        const cookie = ctx.context.createAuthCookie("oauth_state", { maxAge: 600 });
        ctx.setCookie(cookie.name, oauthState, cookie.attributes);
      } else {
        if (!url.searchParams.get("state")) throw invalid();
        const cookie = ctx.context.createAuthCookie("state", { maxAge: 300 });
        await ctx.setSignedCookie(cookie.name, url.searchParams.get("state")!, ctx.context.secret, cookie.attributes);
      }
      return ctx.redirect(url.href);
    }),
  } };
}

export function validFirstPartyAuthorization(url: URL, base: string, oidc?: OidcConfig): boolean {
  if (!oidc || url.protocol !== "https:" || url.username || url.password || url.hash) return false;
  const issuer = new URL(oidc.issuer);
  if (issuer.protocol !== "https:" || issuer.origin !== new URL(base).origin || url.origin !== issuer.origin ||
      url.pathname !== `${issuer.pathname.replace(/\/$/, "")}/oauth/authorize`) return false;
  const q = url.searchParams;
  for (const key of ["state", "nonce", "client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method"])
    if (q.getAll(key).length !== 1 || !q.get(key) || q.get(key)!.length > 2048) return false;
  return q.get("client_id") === oidc.clientId && q.get("redirect_uri") === `${base.replace(/\/$/, "")}/callback/oidc` &&
    q.get("response_type") === "code" && q.get("code_challenge_method") === "S256" && /^[\w-]{43}$/.test(q.get("code_challenge")!);
}
