import { ORPCError } from "@orpc/server";
import type { MycelliosSignInMethods } from "@mycellios/contracts";
import { MYCELLIOS_IDENTITY_LINK_STATE_PARAM, productAppUrl, productBrand } from "@mycellios/contracts";
import { readBoundedJsonResponse } from "@mycellios/core";
import * as z from "zod";
import type { RouterContext } from "./context.js";
import { mycelliosSessionUpstream, upstreamError } from "./mycellios-session-upstream.js";

const REQUEST_TIMEOUT_MS = 15_000;
const SMALL_RESPONSE_BYTES = 16 * 1024;
const USER_RESPONSE_BYTES = 128 * 1024;

const AuthConfig = z.object({ anonKey: z.string().min(1).max(4096).optional() });
const AuthSettings = z.object({
  external: z.object({ google: z.boolean().optional(), twitter: z.boolean().optional() }).partial().optional(),
});
const AuthUser = z.object({
  identities: z
    .array(
      z.object({
        identity_id: z.string().min(1).max(128),
        provider: z.string().min(1).max(64),
        identity_data: z.record(z.string(), z.unknown()).nullish(),
      }),
    )
    .max(50)
    .nullish(),
});
const AuthLink = z.object({ url: z.string().max(4096) });
const LINKABLE = new Set(["google", "twitter"]);

/** The provider page the authority returned; only HTTPS without embedded credentials is followed. */
export function safeProviderLink(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ORPCError("SERVICE_UNAVAILABLE");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new ORPCError("SERVICE_UNAVAILABLE");
  return url.toString();
}

/**
 * Google and X sign-in for the signed-in Mycellios account, through the identity
 * authority's own linking endpoints (the ones the dashboard account dialog used).
 * Calls carry the user's own Mycellios session, read on the server for each request.
 * The provider returns to a fixed Agent settings URL that carries only the browser's
 * own random state; the authority keeps its provider state checks. The last sign-in
 * method is never removed, and only Google and X can be unlinked here.
 */
export function mycelliosIdentityRoutes({ authed, deps }: RouterContext) {
  const { sessionToken, ownedBy } = mycelliosSessionUpstream(deps);
  const transport = () => deps.modelConnectionFetch ?? fetch;

  function authority(): string {
    const issuer = deps.env.mycelliosSso ? deps.env.mycelliosIdentityIssuer : undefined;
    if (!issuer) throw new ORPCError("PRECONDITION_FAILED");
    return issuer.replace(/\/+$/, "");
  }

  async function send(url: string, method: "GET" | "DELETE", headers: Record<string, string>, signal?: AbortSignal) {
    const deadline = AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...(signal ? [signal] : [])]);
    let response: Response;
    try {
      response = await transport()(url, { method, redirect: "error", cache: "no-store", signal: deadline, headers });
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      // 422 is the authority refusing the change itself (for example its own last-identity rule).
      throw response.status === 422 ? new ORPCError("CONFLICT") : upstreamError(response.status);
    }
    return { response, deadline };
  }

  async function read<T>(
    url: string,
    headers: Record<string, string>,
    schema: z.ZodType<T>,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<T> {
    const { response, deadline } = await send(url, "GET", headers, signal);
    try {
      return schema.parse(await readBoundedJsonResponse<unknown>(response, maxBytes, deadline));
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
  }

  /** The public client key some authority gateways require next to the user's bearer. */
  async function publicKey(signal?: AbortSignal): Promise<string | undefined> {
    try {
      const config = await read(
        `${new URL(productBrand.apiBaseUrl).origin}/public/v1/auth-config`,
        {},
        AuthConfig,
        SMALL_RESPONSE_BYTES,
        signal,
      );
      return config.anonKey;
    } catch {
      return undefined;
    }
  }

  async function publicHeaders(signal?: AbortSignal): Promise<Record<string, string>> {
    const key = await publicKey(signal);
    return key ? { apikey: key } : {};
  }

  async function userHeaders(token: string, signal?: AbortSignal): Promise<Record<string, string>> {
    return { ...(await publicHeaders(signal)), authorization: `Bearer ${token}` };
  }

  async function identities(base: string, headers: Record<string, string>, signal?: AbortSignal) {
    const user = await read(`${base}/user`, headers, AuthUser, USER_RESPONSE_BYTES, signal);
    return (user.identities ?? []).map((identity) => ({
      id: identity.identity_id,
      provider: identity.provider,
      email: typeof identity.identity_data?.email === "string" && identity.identity_data.email.length <= 320
        ? identity.identity_data.email
        : null,
    }));
  }

  return {
    mycelliosIdentities: {
      list: authed.mycelliosIdentities.list.handler(async ({ context, input }): Promise<MycelliosSignInMethods> => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const base = authority();
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const keyOnly = await publicHeaders(context.signal);
        const headers = { ...keyOnly, authorization: `Bearer ${token}` };
        const [settings, methods] = await Promise.all([
          read(`${base}/settings`, keyOnly, AuthSettings, SMALL_RESPONSE_BYTES, context.signal).catch(() => null),
          identities(base, headers, context.signal),
        ]);
        return {
          // Unknown availability offers nothing new to link; linked methods stay listed.
          available: {
            google: settings?.external?.google === true,
            twitter: settings?.external?.twitter === true,
          },
          identities: methods,
        };
      }),
      link: authed.mycelliosIdentities.link.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const base = authority();
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const back = new URL(productAppUrl(deps.env.webOrigin, "/app"));
        back.searchParams.set("settings", "profile");
        back.searchParams.set(MYCELLIOS_IDENTITY_LINK_STATE_PARAM, input.state);
        const authorize = new URL(`${base}/user/identities/authorize`);
        authorize.searchParams.set("provider", input.provider);
        authorize.searchParams.set("redirect_to", back.toString());
        authorize.searchParams.set("skip_http_redirect", "true");
        const link = await read(
          authorize.toString(),
          await userHeaders(token, context.signal),
          AuthLink,
          SMALL_RESPONSE_BYTES,
          context.signal,
        );
        return { url: safeProviderLink(link.url) };
      }),
      unlink: authed.mycelliosIdentities.unlink.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const base = authority();
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const headers = await userHeaders(token, context.signal);
        const methods = await identities(base, headers, context.signal);
        const target = methods.find((identity) => identity.id === input.identityId);
        if (!target) throw new ORPCError("NOT_FOUND");
        if (!LINKABLE.has(target.provider)) throw new ORPCError("FORBIDDEN");
        // Never leave the account without a way to sign in.
        if (methods.length < 2) throw new ORPCError("CONFLICT");
        const { response } = await send(
          `${base}/user/identities/${encodeURIComponent(target.id)}`,
          "DELETE",
          headers,
          context.signal,
        );
        await response.body?.cancel().catch(() => undefined);
        return { unlinked: true as const };
      }),
    },
  };
}
