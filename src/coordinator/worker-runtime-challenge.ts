import type { WorkerCapabilities } from "../contracts/types.js";
import type { RuntimePerformanceChallenge } from "../contracts/evidence-challenge.js";

export function runtimeChallengeIdentity(
  capabilities: WorkerCapabilities,
): {
  nodeId: string;
  backend: RuntimePerformanceChallenge["backend"];
  deviceName: string;
  precision: RuntimePerformanceChallenge["precision"];
} | null {
  const executor = capabilities.distributedExecutor;
  if (!executor) return null;
  const acceleration = executor.acceleration;
  if (
    acceleration?.state === "gpu-ready"
    && acceleration.backend
    && acceleration.backend !== "cpu"
    && acceleration.deviceName
    && executor.computeMode !== "cpu-only"
  ) {
    return {
      nodeId: executor.nodeId,
      backend: acceleration.backend,
      deviceName: acceleration.deviceName,
      precision: acceleration.backend === "directml" ? "float32" : "float16",
    };
  }
  if (
    executor.cpuEligible === true
    && executor.computeMode !== "gpu-only"
    && acceleration?.backend === "cpu"
    && acceleration.deviceName
  ) {
    return {
      nodeId: executor.nodeId,
      backend: "cpu",
      deviceName: acceleration.deviceName,
      precision: "float32",
    };
  }
  return null;
}

