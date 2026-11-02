import type { DistributionWorkload } from "./types.js";

export interface DenseStageLimits { minimum: number; maximum: number }

/** Compare numeric work under explicit caller limits without changing a launch. */
export function denseComparableWorkload(
  workload: DistributionWorkload, stageCount: number, limits: DenseStageLimits,
): DistributionWorkload {
  if (!Number.isSafeInteger(limits.minimum) || !Number.isSafeInteger(limits.maximum)
      || limits.minimum < 1 || limits.maximum < limits.minimum || limits.maximum > 8
      || !Number.isSafeInteger(stageCount) || stageCount < limits.minimum || stageCount > limits.maximum
      || !Number.isSafeInteger(workload.maxStages) || workload.maxStages! < stageCount) {
    throw new Error("measured_activation_stage_limits_mismatch");
  }
  return { ...workload, maxStages: limits.maximum };
}
