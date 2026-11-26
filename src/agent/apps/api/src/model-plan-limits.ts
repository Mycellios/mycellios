import { createHash } from "node:crypto";
import {
  oauthCredentialAccountId,
  parseModelSecret,
  readProviderPlanLimits,
} from "@mycellios/adapters";
import {
  type AccountPlanLimit,
  type AccountPlanLimits,
  canonicalPiProviderId,
} from "@mycellios/contracts";
import type { RouterDeps } from "./router.js";

/** Scope of the member reading their quota; a token renewal is written under it. */
export type PlanLimitsScope = { userId: string; spaceId: string };

/**
 * Renews an expired OAuth access token through the runtime's locked refresh, the
 * same writer runs and catalog reads use. Resolves once the stored secret is fresh
 * or the renewal gave up; it never throws for a refused or failed renewal.
 */
export type PlanLimitsCredentialRenewal = (
  scope: PlanLimitsScope,
  secretId: string,
  provider: string,
) => Promise<void>;

/** Passive subscription readings from this member's encrypted connections only. */
export function createModelPlanLimits(
  deps: Pick<RouterDeps, "prisma" | "secrets" | "modelConnectionFetch">,
  now = Date.now,
  renewCredential?: PlanLimitsCredentialRenewal,
) {
  const cache = new Map<string, { at: number; value: AccountPlanLimit }>();
  const pending = new Map<string, Promise<AccountPlanLimit>>();
  /** After a renewal, the secret row holds the new token; read it again under the same scope. */
  async function reloadSecret(userId: string, secretId: string) {
    const [row] = await deps.prisma.secret.findMany({
      where: { id: { in: [secretId] }, userId, spaceId: null },
      select: { id: true, ciphertext: true },
    });
    return row ? parseModelSecret(await deps.secrets.load(row.ciphertext, row.id)) : undefined;
  }
  async function read(
    scope: PlanLimitsScope,
    row: { id: string; provider: string; label: string | null; secretId: string },
    ciphertext: string | undefined,
    refresh: boolean,
  ): Promise<AccountPlanLimit> {
    const { userId } = scope;
    const stamp = now();
    const base: AccountPlanLimit = {
      credentialId: row.id,
      provider: canonicalPiProviderId(row.provider),
      label: row.label || row.provider,
      authKind: "unknown",
      status: "unavailable",
      windows: [],
      plan: null,
      checkedAt: new Date(stamp).toISOString(),
      measuredAt: null,
      retryAt: null,
      reason: "secret_unavailable",
    };
    if (!ciphertext) return base;
    const key = `${userId}:${row.id}:${row.provider}:${row.secretId}:${createHash("sha256").update(ciphertext).digest("hex")}`;
    const saved = cache.get(key);
    const retry = saved?.value.retryAt ? Date.parse(saved.value.retryAt) : 0;
    if (saved && (stamp - saved.at < (refresh ? 15_000 : 60_000) || retry > stamp))
      return { ...saved.value, label: base.label, checkedAt: base.checkedAt };
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      let result = base;
      try {
        let secret = parseModelSecret(await deps.secrets.load(ciphertext, row.secretId));
        result = { ...base, authKind: secret.kind };
        const expired = (credential: { access?: string; expires: number }) =>
          !credential.access ||
          !Number.isFinite(credential.expires) ||
          credential.expires <= stamp;
        // An access token only lasts hours; the stored refresh token keeps the account
        // connected. Renew it as a run would before asking the person to reconnect.
        if (
          secret.kind === "oauth" &&
          ["openai-codex", "anthropic"].includes(base.provider) &&
          expired(secret.credential) &&
          secret.credential.refresh &&
          renewCredential
        ) {
          await renewCredential(scope, row.secretId, row.provider).catch(() => undefined);
          secret = (await reloadSecret(userId, row.secretId)) ?? secret;
        }
        if (secret.kind !== "oauth" || !["openai-codex", "anthropic"].includes(base.provider))
          result = { ...result, status: "unsupported", reason: "not_reported" };
        else if (expired(secret.credential))
          result = { ...result, status: "reconnect", reason: "expired" };
        else {
          const quota = await readProviderPlanLimits({
            provider: base.provider,
            accessToken: secret.credential.access,
            accountId: oauthCredentialAccountId(secret.credential),
            fetch: deps.modelConnectionFetch,
            now: stamp,
          });
          result = {
            ...result,
            ...quota,
            measuredAt: quota.status === "available" ? new Date(now()).toISOString() : null,
          };
        }
      } catch {
        /* Keep secret failures opaque and isolated to this account. */
      }
      cache.set(key, { at: now(), value: result });
      while (cache.size > 256) cache.delete(cache.keys().next().value!);
      return result;
    })();
    pending.set(key, promise);
    try {
      return await promise;
    } finally {
      pending.delete(key);
    }
  }
  return async (scope: PlanLimitsScope, refresh = false): Promise<AccountPlanLimits> => {
    const { userId } = scope;
    const rows = await deps.prisma.userModelCredential.findMany({
      where: { userId },
      select: { id: true, provider: true, label: true, secretId: true },
      orderBy: { createdAt: "asc" },
    });
    const secrets = rows.length
      ? await deps.prisma.secret.findMany({
          where: { id: { in: rows.map((row) => row.secretId) }, userId, spaceId: null },
          select: { id: true, ciphertext: true },
        })
      : [];
    const byId = new Map(secrets.map((secret) => [secret.id, secret.ciphertext]));
    // Bound provider concurrency. A deadline prevents a long account list from
    // making the rail wait indefinitely; no background requests after the cutoff.
    const deadline = now() + 15_000;
    const accounts: AccountPlanLimit[] = new Array(rows.length);
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, rows.length) }, async () => {
        while (cursor < rows.length) {
          const index = cursor++;
          const row = rows[index]!;
          if (now() >= deadline) {
            accounts[index] = {
              credentialId: row.id,
              provider: canonicalPiProviderId(row.provider),
              label: row.label || row.provider,
              authKind: "unknown",
              status: "unavailable",
              windows: [],
              plan: null,
              checkedAt: new Date(now()).toISOString(),
              measuredAt: null,
              retryAt: null,
              reason: "timeout",
            };
            continue;
          }
          accounts[index] = await read(scope, row, byId.get(row.secretId), refresh);
        }
      }),
    );
    return { accounts, checkedAt: new Date(now()).toISOString() };
  };
}
