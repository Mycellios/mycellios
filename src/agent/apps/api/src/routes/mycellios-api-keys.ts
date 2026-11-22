import { ORPCError } from "@orpc/server";
import type { MycelliosApiKey } from "@mycellios/contracts";
import { productBrand } from "@mycellios/contracts";
import { readBoundedJsonResponse } from "@mycellios/core";
import * as z from "zod";
import { ownedMycelliosConnection } from "../mycellios-owned-connection.js";
import type { RouterContext } from "./context.js";

const REQUEST_TIMEOUT_MS = 15_000;
const LIST_RESPONSE_BYTES = 512 * 1024;
const KEY_RESPONSE_BYTES = 16 * 1024;

const UpstreamKey = z.object({
  id: z.string().min(1).max(100),
  name: z.string().max(200),
  prefix: z.string().max(64),
  created_at: z.string().max(64),
  last_used_at: z.string().max(64).nullable(),
  revoked_at: z.string().max(64).nullable(),
});
const UpstreamKeyList = z.object({ data: z.array(UpstreamKey).max(1000) });
const UpstreamCreatedKey = UpstreamKey.extend({ secret: z.string().min(16).max(4096) });

/** The key belongs to Agent's own connection when its public prefix starts the saved secret. */
export function isAgentKey(prefix: string, agentSecret: string | undefined): boolean {
  return Boolean(agentSecret && prefix.length >= 8 && agentSecret.startsWith(`${prefix}_`));
}

function toKey(key: z.infer<typeof UpstreamKey>, agentSecret: string | undefined): MycelliosApiKey {
  return {
    id: key.id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.created_at,
    lastUsedAt: key.last_used_at,
    revokedAt: key.revoked_at,
    usedByAgent: isAgentKey(key.prefix, agentSecret),
  };
}

function upstreamError(status: number): ORPCError<string, unknown> {
  if (status === 401) return new ORPCError("UNAUTHORIZED");
  if (status === 403) return new ORPCError("FORBIDDEN");
  if (status === 404 || status === 501) return new ORPCError("PRECONDITION_FAILED");
  if (status === 409) return new ORPCError("CONFLICT");
  if (status === 429) return new ORPCError("TOO_MANY_REQUESTS");
  return new ORPCError("SERVICE_UNAVAILABLE");
}

/**
 * The signed-in user's Mycellios API keys, read and changed with that user's own
 * Mycellios session. Session tokens and stored connection secrets stay on the server;
 * a newly created secret is returned once, to this caller only, and never logged.
 */
export function mycelliosApiKeyRoutes({ authed, deps }: RouterContext) {
  async function sessionToken(headers: Headers | undefined, userId: string) {
    if (!deps.env.mycelliosSso || !headers) throw new ORPCError("PRECONDITION_FAILED");
    const token = await deps.auth.oidcAccessToken(headers, userId);
    if (!token) throw new ORPCError("UNAUTHORIZED");
    return token;
  }

  async function agentSecret(userId: string): Promise<string | undefined> {
    try {
      return (await ownedMycelliosConnection(deps, userId))?.saved.apiKey ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function call(
    token: string,
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: string },
    signal?: AbortSignal,
  ) {
    const deadline = AbortSignal.any([
      AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]);
    let response: Response;
    try {
      response = await (deps.modelConnectionFetch ?? fetch)(`${productBrand.apiBaseUrl}${path}`, {
        method: init.method,
        redirect: "error",
        cache: "no-store",
        signal: deadline,
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
      });
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw upstreamError(response.status);
    }
    return { response, deadline };
  }

  async function readKeys(token: string, signal?: AbortSignal) {
    const { response, deadline } = await call(token, "/api-keys", { method: "GET" }, signal);
    try {
      return UpstreamKeyList.parse(
        await readBoundedJsonResponse<unknown>(response, LIST_RESPONSE_BYTES, deadline),
      ).data;
    } catch {
      throw new ORPCError("SERVICE_UNAVAILABLE");
    }
  }

  function ownedBy(expectedUserId: string, userId: string) {
    if (expectedUserId !== userId) throw new ORPCError("FORBIDDEN");
  }

  return {
    mycelliosApiKeys: {
      list: authed.mycelliosApiKeys.list.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const [keys, secret] = await Promise.all([
          readKeys(token, context.signal),
          agentSecret(context.actor.userId),
        ]);
        return {
          apiBaseUrl: productBrand.apiBaseUrl,
          keys: keys.map((key) => toKey(key, secret)),
        };
      }),
      create: authed.mycelliosApiKeys.create.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        const { response, deadline } = await call(
          token,
          "/api-keys",
          { method: "POST", body: JSON.stringify({ name: input.name }) },
          context.signal,
        );
        let created: z.infer<typeof UpstreamCreatedKey>;
        try {
          created = UpstreamCreatedKey.parse(
            await readBoundedJsonResponse<unknown>(response, KEY_RESPONSE_BYTES, deadline),
          );
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE");
        }
        const { secret, ...key } = created;
        return { key: toKey(key, undefined), secret };
      }),
      revoke: authed.mycelliosApiKeys.revoke.handler(async ({ context, input }) => {
        ownedBy(input.expectedUserId, context.actor.userId);
        const token = await sessionToken(context.requestHeaders, context.actor.userId);
        // Agent's own key funds every Mico on Mycellios Credits; revoking it here would
        // silently break the saved connection, so it is refused before any change.
        const [keys, secret] = await Promise.all([
          readKeys(token, context.signal),
          agentSecret(context.actor.userId),
        ]);
        const target = keys.find((key) => key.id === input.keyId);
        if (!target) throw new ORPCError("NOT_FOUND");
        if (isAgentKey(target.prefix, secret)) throw new ORPCError("FORBIDDEN");
        if (target.revoked_at) return { revoked: true as const };
        const { response } = await call(
          token,
          `/api-keys/${encodeURIComponent(input.keyId)}`,
          { method: "DELETE" },
          context.signal,
        );
        await response.body?.cancel().catch(() => undefined);
        return { revoked: true as const };
      }),
    },
  };
}
