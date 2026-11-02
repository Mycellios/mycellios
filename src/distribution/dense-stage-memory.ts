import { denseStagePolicySchema } from "../contracts/dense-stage.js";
import type { ComputeNodeProfile, DistributedModelProfile, DistributionWorkload, StagePlacement } from "./types.js";

/** Admission ceilings, not a prediction of cache hits or execution speed. */
export function denseStageMemoryAdmission(
  model: DistributedModelProfile, stage: StagePlacement, node: ComputeNodeProfile,
  workload: DistributionWorkload, completeStageBytes: number, first: boolean, last: boolean,
): { graphicsBytes: number; error: string | null } | null {
  if (stage.dense === undefined) return null;
  const policy = denseStagePolicySchema.parse(stage.dense);
  const capacity = node.memoryBytes - node.reserveBytes;
  if (!Number.isSafeInteger(node.hostMemoryBytes) || node.hostMemoryBytes! <= 0
      || policy.hostRamBudgetBytes > node.hostMemoryBytes!) {
    return { graphicsBytes: policy.vramBudgetBytes, error: `dense_host_memory_exceeded:${node.id}` };
  }
  // Header weight sizes are source bytes. Doubling for FP32 is conservative
  // for supported F16/BF16/F32 sources; native admission checks exact tensors.
  const scale = policy.precision === "float32" ? 2 : 1;
  const layers = model.layers.slice(stage.layerStart, stage.layerEnd);
  const largestLayer = Math.max(...layers.map(layer => layer.weightBytes * scale));
  const runtime = model.runtimeOverheadBytesPerStage + layers.reduce((sum, layer) =>
    sum + layer.kvBytesPerToken * workload.contextTokens * workload.concurrentSequences, 0);
  if (policy.executionTarget === "cpu") {
    const required = completeStageBytes * scale + Math.max(0, policy.activationReserveBytes - runtime);
    return { graphicsBytes: 0, error: !Number.isSafeInteger(required)
      || required > policy.hostRamBudgetBytes ? `dense_host_geometry_exceeded:${node.id}` : null };
  }
  const endpoint = ((first && !policy.hostTokenLookup ? model.embeddingBytes : 0)
    + (last ? model.lmHeadBytes : 0)) * scale;
  const graphicsRequired = policy.memoryMode === "resident"
    ? completeStageBytes * scale : largestLayer + endpoint + Math.max(runtime, policy.activationReserveBytes);
  // Known shared graphics and retained source weights use the same physical RAM.
  // Native admission still measures actual sharing and tensor conversion scratch.
  const stagingBytes = denseHostStagingBytes(model, stage, scale);
  if (stagingBytes === null) return { graphicsBytes: policy.vramBudgetBytes, error: `dense_host_staging_geometry_unknown:${node.id}` };
  const hostRequired = completeStageBytes * scale + stagingBytes
    + (node.deviceMemorySharesHost === true ? policy.vramBudgetBytes : 0);
  if (![graphicsRequired, hostRequired].every(value => Number.isSafeInteger(value) && value >= 0)
      || hostRequired > policy.hostRamBudgetBytes) {
    return { graphicsBytes: policy.vramBudgetBytes, error: `dense_host_geometry_exceeded:${node.id}` };
  }
  if (graphicsRequired > policy.vramBudgetBytes || policy.vramBudgetBytes > capacity) {
    return { graphicsBytes: policy.vramBudgetBytes, error: `dense_graphics_memory_exceeded:${node.id}` };
  }
  return { graphicsBytes: policy.vramBudgetBytes, error: null };
}

/** Pinned staging remains allocated alongside authoritative host weights. */
export function denseHostStagingBytes(model: DistributedModelProfile, stage: StagePlacement, scale: number): number | null {
  if (!stage.dense?.pinHostStaging) return 0;
  const layers = model.layers.slice(stage.layerStart, stage.layerEnd);
  if (!layers.length || layers.some(layer => !Number.isSafeInteger(layer.largestResidentTensorBytes)
      || layer.largestResidentTensorBytes! <= 0 || layer.largestResidentTensorBytes! > layer.weightBytes)) return null;
  const bytes = Math.max(...layers.map(layer => layer.largestResidentTensorBytes! * scale));
  return Number.isSafeInteger(bytes) ? bytes : null;
}
