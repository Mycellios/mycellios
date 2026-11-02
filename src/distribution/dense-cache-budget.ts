export interface DenseCacheBudgetInput {
  /** Fresh physical ceilings after other reservations, from authenticated inventory. */
  hostAvailableBytes: number;
  graphicsAvailableBytes: number;
  deviceMemorySharesHost: boolean;
  /** Cold host weights, including endpoint mirrors, at the certified precision. */
  hostWeightBytes: number;
  hostScratchBytes: number;
  hostActivationBytes: number;
  graphicsStaticWeightBytes: number;
  graphicsActivationBytes: number;
  layerWeightBytes: readonly number[];
}

export interface DenseCacheBudget {
  hostBudgetBytes: number;
  graphicsBudgetBytes: number;
  cacheCapacityBytes: number;
  retainedPrefixLayers: number;
  fullLayerResidency: boolean;
}

function sum(values: readonly number[]): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) throw new Error("dense_memory_sum_overflow");
  return result;
}

/** Maximize feasible cache capacity; measured complete costs still choose the route. */
export function planDenseCacheBudget(input: DenseCacheBudgetInput): DenseCacheBudget | null {
  const bytes = [input.hostAvailableBytes, input.graphicsAvailableBytes,
    input.hostWeightBytes, input.hostScratchBytes, input.hostActivationBytes,
    input.graphicsStaticWeightBytes, input.graphicsActivationBytes, ...input.layerWeightBytes];
  if (typeof input.deviceMemorySharesHost !== "boolean" || input.layerWeightBytes.length === 0
      || bytes.some((value) => !Number.isSafeInteger(value) || value < 0)
      || input.layerWeightBytes.some((value) => value === 0)) {
    throw new Error("dense_memory_geometry_invalid");
  }
  const hostBase = sum([input.hostWeightBytes, input.hostScratchBytes, input.hostActivationBytes]);
  const graphicsBase = sum([input.graphicsStaticWeightBytes, input.graphicsActivationBytes]);
  const totalLayers = sum(input.layerWeightBytes);
  const capacity = Math.min(totalLayers, input.graphicsAvailableBytes - graphicsBase,
    input.deviceMemorySharesHost ? input.hostAvailableBytes - hostBase - graphicsBase : totalLayers);
  const largest = input.layerWeightBytes.reduce((maximum, value) => Math.max(maximum, value), 0);
  if (input.hostWeightBytes < sum([totalLayers, input.graphicsStaticWeightBytes])) {
    throw new Error("dense_cold_weight_geometry_incomplete");
  }
  if (hostBase > input.hostAvailableBytes || capacity < largest) return null;
  let retainedBytes = 0;
  let retainedPrefixLayers = 0;
  for (const weight of input.layerWeightBytes) {
    if (retainedBytes + weight + largest > capacity) break;
    retainedBytes += weight;
    retainedPrefixLayers++;
  }
  const graphicsBudgetBytes = sum([graphicsBase, capacity]);
  const hostBudgetBytes = sum([hostBase, input.deviceMemorySharesHost ? graphicsBudgetBytes : 0]);
  return { hostBudgetBytes, graphicsBudgetBytes, cacheCapacityBytes: capacity,
    retainedPrefixLayers, fullLayerResidency: capacity === totalLayers };
}
