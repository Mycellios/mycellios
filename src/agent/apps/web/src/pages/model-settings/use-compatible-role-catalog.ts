import type { ModelCredential } from "@rakazo/contracts";
import { ANTSEED_PROVIDER_ID, isMycelliosBaseUrl, isOpenAiCompatibleProvider, OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";
import { useQueries } from "@tanstack/react-query";
import { useSpaceRpc } from "../../lib/space-rpc";
import type { RpcClient } from "../../lib/rpc";
import { classifyModelConnectionFailure } from "../../lib/model-connection-preflight";

export const compatibleRoleCatalogKey = (userId: string, spaceId: string, credentialId: string, baseUrl: string) =>
  ["compatible-role-catalog", userId, spaceId, credentialId, baseUrl];

export async function discoverCompatibleModels(rpc: RpcClient, connection: ModelCredential, spaceId: string, signal?: AbortSignal) {
  const options = { context: { spaceId }, ...(signal ? { signal } : {}) };
  if (isMycelliosBaseUrl(connection.baseUrl)) {
    const entries=await rpc.models.mycelliosModels(undefined,options);
    return {models:entries.map(entry=>entry.id),entries:entries.map(({id,label,billing})=>({id,label,billing}))};
  }
  return rpc.models.probeOpenAiCompatible({
    provider: connection.provider === ANTSEED_PROVIDER_ID ? ANTSEED_PROVIDER_ID : OPENAI_COMPATIBLE_PROVIDER_ID,
    baseUrl: connection.baseUrl!,
    credentialId: connection.id,
  }, options);
}

/** Discover with the saved, owned connection; keys never enter the browser. */
export function useCompatibleRoleCatalog(
  credentials: ModelCredential[],
  userId: string,
  spaceId: string,
  open: boolean,
  mycelliosOnly = false,
) {
  const rpc = useSpaceRpc();
  // Mycellios uses its authenticated, Credit-funded chat-only RPC. A generic
  // compatible /models endpoint can also contain embedding and speech services.
  const compatible = credentials.filter(entry => isOpenAiCompatibleProvider(entry.provider) && entry.baseUrl && (!mycelliosOnly || isMycelliosBaseUrl(entry.baseUrl)));
  const queries = useQueries({ queries: compatible.map(connection => ({
    queryKey: compatibleRoleCatalogKey(userId, spaceId, connection.id, connection.baseUrl!),
    queryFn: () => discoverCompatibleModels(rpc, connection, spaceId),
    enabled: open,
    staleTime: 60_000,
    retry: (count: number, error: unknown) => count < 1 && classifyModelConnectionFailure(error).outcome === "timeout",
  })) });
  return {
    credentials: credentials.flatMap(connection => {
      const index = compatible.findIndex(entry => entry.id === connection.id);
      const models = index < 0 ? undefined : queries[index]?.data?.models;
      if (isMycelliosBaseUrl(connection.baseUrl) && (!models?.length || queries[index]?.isError)) return [];
      return models ? {
        ...connection,
        enabledModelIds: isMycelliosBaseUrl(connection.baseUrl)
          ? models
          : [...new Set([...(connection.enabledModelIds ?? []), connection.modelId ?? "", ...models])].filter(Boolean),
      } : connection;
    }),
    loading: open && queries.some(query => query.isFetching),
    failed: queries.some(query => query.isError),
  };
}
