import type { AdapterContext } from "@rakazo/adapter-kit";
import type { ConnectionIdentity } from "@rakazo/contracts";
import type { ComposioClient } from "./composio-connector.js";

const CACHE_MS = 60_000;
const MAX_CACHE_ENTRIES = 128;
const MAX_PAGES = 20;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function label(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Public profile labels must reject control characters.
  return text && text.length <= 240 && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

/** Only documented public profile fields cross the connector boundary. */
function profileIdentity(value: unknown): ConnectionIdentity | null {
  const root = object(value);
  const profile = object(root?.data) ?? object(root?.user) ?? root;
  if (!profile) return null;
  const username = label(profile.username) ?? label(profile.login) ?? label(profile.screen_name);
  if (username) {
    const handle = label(username.startsWith("@") ? username : `@${username}`);
    if (handle) return { label: handle };
  }
  const name = label(profile.emailAddress) ?? label(profile.email) ?? label(profile.name);
  return name ? { label: name } : null;
}

async function readIdentity(
  sdk: ComposioClient,
  request: { provider: string; connectionRef: string },
  context: AdapterContext,
): Promise<ConnectionIdentity | null> {
  const signal = context.signal
    ? AbortSignal.any([context.signal, AbortSignal.timeout(8_000)])
    : AbortSignal.timeout(8_000);
  const options = { signal };
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const page = await sdk.connectedAccounts.list(
      {
        userIds: [context.userId],
        toolkitSlugs: [request.provider],
        statuses: ["ACTIVE"],
        limit: 100,
        cursor,
      },
      options,
    );
    const account = page.items.find(
      (item) =>
        item.id === request.connectionRef &&
        item.toolkit.slug.toLowerCase() === request.provider.toLowerCase() &&
        item.status === "ACTIVE" &&
        !item.isDisabled,
    );
    if (account) {
      // alias, wordId, userId and legacy data/params are not provider identities.
      const displayName = label(object(object(account.state)?.val)?.displayName);
      const fallback = displayName ? { label: displayName } : null;
      if (!sdk.toolkits || !sdk.tools) return fallback;
      try {
        const toolkit = await sdk.toolkits.get(request.provider, options);
        if (
          toolkit.getCurrentUserEndpointMethod?.toUpperCase() !== "GET" ||
          !toolkit.getCurrentUserEndpoint
        )
          return fallback;
        const endpoint = new URL(toolkit.getCurrentUserEndpoint, toolkit.baseUrl);
        if (
          endpoint.protocol !== "https:" ||
          endpoint.username ||
          endpoint.password ||
          endpoint.hash
        )
          return fallback;
        const response = await sdk.tools.proxyExecute(
          { endpoint: endpoint.href, method: "GET", connectedAccountId: account.id },
          options,
        );
        return response.status === 200 ? (profileIdentity(response.data) ?? fallback) : fallback;
      } catch {
        return fallback;
      }
    }
    if (!page.nextCursor || page.nextCursor === cursor) return null;
    cursor = page.nextCursor;
  }
  return null;
}

/** Cache only the safe projection, scoped to the owner, Space and exact authorization. */
export function createComposioIdentityReader(client: () => ComposioClient) {
  const cache = new Map<string, { expires: number; value: Promise<ConnectionIdentity | null> }>();
  return (request: { provider: string; connectionRef: string }, context: AdapterContext) => {
    if (
      context.signal?.aborted ||
      !request.connectionRef ||
      request.connectionRef === request.provider
    )
      return Promise.resolve(null);
    const key = JSON.stringify([
      context.userId,
      context.spaceId,
      request.provider,
      request.connectionRef,
    ]);
    const saved = cache.get(key);
    if (saved && saved.expires > Date.now()) return saved.value;
    const value = Promise.resolve()
      .then(() => readIdentity(client(), request, context))
      .catch(() => null);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + CACHE_MS, value });
    void value.then(() => {
      if (context.signal?.aborted && cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  };
}
