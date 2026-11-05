import type { ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";
import type { RpcClient } from "./rpc";
import { rpc, rpcForSpace } from "./rpc";
import type { TaskThreadScope } from "./task-thread-scope";

type SpaceRpc = { client: RpcClient; spaceId: string | null; taskScope?: TaskThreadScope };

const SpaceRpcContext = createContext<SpaceRpc>({ client: rpc, spaceId: null });

/** Points the settings panels below at one space's data. */
export function SpaceRpcProvider({
  spaceId,
  client,
  taskScope,
  children,
}: {
  spaceId: string | null | undefined;
  client?: RpcClient;
  taskScope?: TaskThreadScope;
  children: ReactNode;
}) {
  const value = useMemo<SpaceRpc>(
    () => client ? { client, spaceId: spaceId ?? null, taskScope } : (spaceId ? { client: rpcForSpace(spaceId), spaceId } : { client: rpc, spaceId: null }),
    [spaceId, client, taskScope],
  );
  return <SpaceRpcContext.Provider value={value}>{children}</SpaceRpcContext.Provider>;
}

/** The rpc client for the space these settings act on. */
export function useSpaceRpc(): RpcClient {
  return useContext(SpaceRpcContext).client;
}

/** The space settings are bound to, or null when they follow the selected space. */
export function useBoundSpaceId(): string | null {
  return useContext(SpaceRpcContext).spaceId;
}

export function useBoundTaskThreadScope(): TaskThreadScope | undefined {
  return useContext(SpaceRpcContext).taskScope;
}
