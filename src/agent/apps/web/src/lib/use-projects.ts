import { useQuery } from "@tanstack/react-query";
import type { RpcClient } from "./rpc";

export function useProjects(rpc: RpcClient, userId: string | null, spaceId: string | null) {
  const query = useQuery({
    queryKey: ["development-projects", userId, spaceId],
    queryFn: () => rpc.development.projects({}), enabled: Boolean(userId),
    staleTime: 5000, refetchInterval: 15000, retry: false,
  });
  return { projects: query.data ?? [], error: query.isError, refresh: () => { void query.refetch(); } };
}
