import { ORPCError } from "@orpc/server";
import type { CodexLiveCatalog } from "@rakazo/adapters";
import { serializeModelSecret } from "@rakazo/adapters";
import type { Actor } from "@rakazo/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { persistModelCredential } from "./model-credentials.js";
import { ownedMycelliosConnection } from "./mycellios-owned-connection.js";
import { MycelliosConnectionUnavailable, provisionMycelliosConnection } from "./mycellios-sso-connection.js";
import type { RouterDeps } from "./router.js";

/** Account setup creates no inference, reservation or credit award. */
export function createMycelliosProvider(deps: RouterDeps, codexCatalog: CodexLiveCatalog) {
  const pending = new Map<string, ReturnType<typeof persistModelCredential>>();
  async function connect(actor: Actor, headers?: Headers, signal?: AbortSignal) {
    const active = pending.get(actor.userId);
    if (active) return active;
    const setup = (async () => {
      const existing = await ownedMycelliosConnection(deps, actor.userId);
      let token = existing?.saved.apiKey;
      if (!token) {
        if (!deps.env.mycelliosSso || !headers)
          throw new ORPCError("FORBIDDEN", { message: "Sign in with Mycellios to connect this account." });
        token = await deps.auth.oidcAccessToken(headers, actor.userId) ?? undefined;
        if (!token) throw new ORPCError("UNAUTHORIZED");
      }
      const provisioned = await provisionMycelliosConnection(token, {
        modelId: existing?.credential.userPreferences?.[0]?.modelId ?? deps.env.defaultModel,
        existing: existing?.saved, fetch: deps.modelConnectionFetch, signal,
      }).catch((error: unknown) => {
        if (error instanceof MycelliosConnectionUnavailable)
          throw new ORPCError("SERVICE_UNAVAILABLE", { message: error.message });
        throw error;
      });
      try {
        return await persistModelCredential(deps, actor, {
          provider: OPENAI_COMPATIBLE_PROVIDER_ID,
          credentialId: existing?.credential.id ?? null,
          plaintext: serializeModelSecret({
            ...provisioned.connection,
            maxTokens: existing?.saved.maxTokens ?? deps.env.defaultModelMaxTokens,
            contextWindow: existing?.saved.contextWindow ?? deps.env.defaultModelContextWindow,
            enabledModelIds: [...new Set([...(existing?.saved.enabledModelIds ?? []), provisioned.modelId])],
          }),
          label: "Mycellios", modelId: provisioned.modelId,
          keepExistingDefault: true, scope: "account", signal,
        }, codexCatalog);
      } catch (error) {
        await provisioned.revoke();
        throw error;
      }
    })();
    pending.set(actor.userId, setup);
    try { return await setup; }
    finally { if (pending.get(actor.userId) === setup) pending.delete(actor.userId); }
  }
  return {
    connect,
    async ensure(actor: Actor, headers?: Headers, signal?: AbortSignal) {
      if (!deps.env.mycelliosSso || !headers) return;
      const existing = await ownedMycelliosConnection(deps, actor.userId);
      if (existing?.saved.apiKey && existing.saved.headers?.["x-mycellios-funding"] === "contribution-credits") return;
      // An unavailable account service must not prevent access to the user's
      // other providers. The permanent provider entry offers an explicit retry.
      const setupSignal = AbortSignal.any([AbortSignal.timeout(8_000), ...(signal ? [signal] : [])]);
      try { await connect(actor, headers, setupSignal); }
      catch (error) {
        if (!(error instanceof ORPCError)) throw error;
      }
    },
  };
}
