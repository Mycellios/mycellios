type AuthConfig = {
  toolkit: { slug: string };
  status: string;
  isEnabledForToolRouter?: boolean;
  isComposioManaged?: boolean;
};

type ConfigCount = { total: number; enabled: number; custom: number };
export type ComposioAuthReadiness = ReadonlyMap<string, ConfigCount>;

/** Availability belongs to the deployment's credentials, independently of user consent. */
export function isComposioAuthReady(
  configs: ComposioAuthReadiness,
  slug: string,
  noAuth: boolean,
): boolean {
  const entry = configs.get(slug.trim().toLowerCase());
  if (!entry) return noAuth;
  return entry.enabled > 0 && entry.custom <= 1;
}

/** Cache safe counts only, inside one credential-bound adapter. Fail closed on incomplete reads. */
export function createComposioAuthReadiness(
  list: (
    params: { showDisabled: true; limit: number; cursor?: string },
    options: { signal: AbortSignal },
  ) => Promise<{ items: AuthConfig[]; nextCursor?: string | null }>,
  now: () => number = Date.now,
) {
  let current: { value: ComposioAuthReadiness; expiresAt: number } | undefined;
  let pending: Promise<ComposioAuthReadiness> | undefined;
  async function load(): Promise<ComposioAuthReadiness> {
    const signal = AbortSignal.timeout(20_000);
    const value = new Map<string, ConfigCount>();
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await list(
        { showDisabled: true, limit: 200, ...(cursor ? { cursor } : {}) },
        { signal },
      );
      for (const config of result.items) {
        const slug = config.toolkit.slug.trim().toLowerCase();
        const entry = value.get(slug) ?? { total: 0, enabled: 0, custom: 0 };
        entry.total += 1;
        if (config.status === "ENABLED" && config.isEnabledForToolRouter === true) {
          entry.enabled += 1;
          if (config.isComposioManaged === false) entry.custom += 1;
        }
        value.set(slug, entry);
      }
      if (!result.nextCursor) {
        current = { value, expiresAt: now() + 60_000 };
        return value;
      }
      if (seen.has(result.nextCursor)) throw new Error("Repeated authentication metadata cursor");
      seen.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("Authentication metadata pagination limit reached");
  }
  return {
    get(): Promise<ComposioAuthReadiness> {
      if (current && current.expiresAt > now()) return Promise.resolve(current.value);
      pending ??= load().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
