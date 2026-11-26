import { useQuery } from "@tanstack/react-query";
import { projectHistoryPreferenceKey, readLastProjectThread } from "./project-history-preload";
import { queryClient, readConversationHistory } from "./query";
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
    refetchInterval: 15000,
  });
  return { projects: query.data ?? [], error: query.isError, refresh: () => { void query.refetch(); } };
}

/** Start a single read before the sidebar mounts, using the authenticated bootstrap's Space. */
export async function warmRememberedProjectHistory(userId: string, spaceId: string): Promise<void> {
  if (document.visibilityState !== "visible") return;
  const threadId = readLastProjectThread(projectHistoryPreferenceKey(userId, spaceId));
  if (!threadId) return;

  const projects = await queryClient.fetchQuery(projectCollectionOptions(createSpaceRpc(spaceId), userId, spaceId));
  if (document.visibilityState !== "visible") return;
  const project = projects.find(item => item.conversations.some(chat => chat.threadId === threadId));
  const chat = project?.conversations.find(item => item.threadId === threadId);
  if (chat) await readConversationHistory(userId, spaceId, chat.botId, { botId: chat.botId, taskThreadId: threadId });
}
