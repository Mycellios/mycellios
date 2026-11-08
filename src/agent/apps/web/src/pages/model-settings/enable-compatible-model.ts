import { MAX_ENABLED_MODEL_IDS, type ModelCredential } from "@rakazo/contracts";
import type { RpcClient } from "../../lib/rpc";

export function savedModelIds(connection: ModelCredential) {
  return [...new Set([connection.modelId ?? "", ...(connection.enabledModelIds ?? [])])].filter(Boolean);
}

export async function enableCompatibleModel(
  rpc: RpcClient,
  spaceId: string,
  connection: ModelCredential,
  modelId: string,
  limitMessage: string,
) {
  const enabled = savedModelIds(connection);
  if (enabled.includes(modelId)) return connection;
  if (enabled.length >= MAX_ENABLED_MODEL_IDS) throw new Error(limitMessage);
  return rpc.models.connect({
    provider: connection.provider,
    credentialId: connection.id,
    baseUrl: connection.baseUrl,
    modelId: connection.modelId || modelId,
    enabledModelIds: [...enabled, modelId],
    makeDefault: false,
  }, { context: { spaceId } });
}
