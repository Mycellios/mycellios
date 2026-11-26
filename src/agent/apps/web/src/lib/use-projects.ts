import { useQuery } from "@tanstack/react-query";
import {
  projectHistoryPreferenceKey, projectHistoryPreloads, readLastProjectThread, scopedProjectHistoryPreloader,
} from "./project-history-preload";
import { queryClient, readConversationHistory, spaceQueries } from "./query";
import { createSpaceRpc, type RpcClient } from "./rpc";

function projectCollectionOptions(rpc: RpcClient, userId: string | null, spaceId: string | null) {
  return {
    queryKey: ["development-projects", userId, spaceId],
    queryFn: ({ signal }: { signal: AbortSignal }) => rpc.development.projects({}, { signal }),
    staleTime: 5000,
    retry: false as const,
  };
}

export function useProjects(rpc: RpcClient, userId: string | null, spaceId: string | null) {
  const query = useQuery({
    ...projectCollectionOptions(rpc, userId, spaceId),
    enabled: Boolean(userId && spaceId),
    refetchOnMount: true,
    // Project folders change rarely; a slower poll spares the shared API.
    refetchInterval: 30_000,
  });
  return { projects: query.data ?? [], error: query.isError, refresh: () => { void query.refetch(); } };
}

/** Start the scoped background queue while the default chat mounts. */
export async function warmInitialProjectHistories(userId: string, spaceId: string): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const key = projectHistoryPreferenceKey(userId, spaceId);
  const remembered = readLastProjectThread(key);
  const projects = await queryClient.fetchQuery(projectCollectionOptions(createSpaceRpc(spaceId), userId, spaceId));
  if (document.visibilityState !== "visible") return;
  const targets = projectHistoryPreloads(projects, undefined, undefined, remembered, undefined);
  scopedProjectHistoryPreloader(key).schedule(targets, async (botId, taskThreadId) => {
    const scope = { botId, taskThreadId };
    const historyKey = spaceQueries(userId, spaceId, scope).threads.get.queryKey({ input: { botId } });
    if (!queryClient.getQueryData(historyKey)) await readConversationHistory(userId, spaceId, botId, scope);
  }, true);
}
