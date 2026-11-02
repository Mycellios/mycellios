import type { WorkerConfig } from "../contracts/schemas.js";

export function defaultWorkerIdentity(
  config: Pick<WorkerConfig, "instanceId" | "capacityScope">,
  executor?: { nodeId: string },
): { kind: "device" | "cell"; id: string } | undefined {
  if (executor) return { kind: "device", id: executor.nodeId };
  if (config.instanceId) {
    return {
      kind: config.capacityScope === "cell" ? "cell" : "device",
      id: config.instanceId,
    };
  }
  return undefined;
}
