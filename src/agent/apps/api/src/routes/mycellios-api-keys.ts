import { ORPCError } from "@orpc/server";
import type { MycelliosApiKey } from "@mycellios/contracts";
import { productBrand } from "@mycellios/contracts";
import * as z from "zod";
import { ownedMycelliosConnection } from "../mycellios-owned-connection.js";
import type { RouterContext } from "./context.js";
import { mycelliosSessionUpstream } from "./mycellios-session-upstream.js";

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

/**
 * The signed-in user's Mycellios API keys, read and changed with that user's own
 * Mycellios session. Session tokens and stored connection secrets stay on the server;
 * a newly created secret is returned once, to this caller only, and never logged.
 */
export function mycelliosApiKeyRoutes({ authed, deps }: RouterContext) {
  const { sessionToken, call, json, ownedBy } = mycelliosSessionUpstream(deps);

  async function agentSecret(userId: string): Promise<string | undefined> {
    try {
      return (await ownedMycelliosConnection(deps, userId))?.saved.apiKey ?? undefined;
    } catch {
      return undefined;
    }
  }

  async function readKeys(token: string, signal?: AbortSignal) {
    return (await json(token, "/api-keys", { method: "GET" }, UpstreamKeyList, LIST_RESPONSE_BYTES, signal)).data;
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
        const created = await json(
          token,
          "/api-keys",
          { method: "POST", body: JSON.stringify({ name: input.name }) },
          UpstreamCreatedKey,
          KEY_RESPONSE_BYTES,
          context.signal,
        );
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
