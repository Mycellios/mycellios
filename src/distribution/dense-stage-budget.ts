import { denseHostStagingBytes } from "./dense-stage-memory.js";
import { denseStagePolicySchema, type DenseStagePolicy } from "../contracts/dense-stage.js";
import { planDenseCacheBudget } from "./dense-cache-budget.js";
import { stageMemoryBytes } from "./cost-model.js";
import type { ComputeNodeProfile, DistributedModelProfile, DistributionWorkload, StagePlacement } from "./types.js";

/** Operator-certified loader geometry; capacities still come from fresh offers. */
export interface DenseBudgetGeometry {
  hostHeadroomBytes: number;
  hostScratchBytes: number;
  graphicsStaticOverheadBytes: number;
}

export function validateDenseBudgetGeometry(value: DenseBudgetGeometry): void {
  if (!value || Object.keys(value).sort().join(",") !== "graphicsStaticOverheadBytes,hostHeadroomBytes,hostScratchBytes"
      || Object.values(value).some(bytes => !Number.isSafeInteger(bytes) || bytes < 0)) {
    throw new Error("dense_budget_geometry_invalid");
  }
}

/** Produce a calibration policy within offered ceilings, never a speed qualification. */
export function budgetDenseStage(input: {
  model: DistributedModelProfile; stage: StagePlacement; node: ComputeNodeProfile;
  workload: DistributionWorkload; first: boolean; last: boolean;
  policy: DenseStagePolicy; geometry: DenseBudgetGeometry;
}): DenseStagePolicy | null {
  validateDenseBudgetGeometry(input.geometry);
  const { model, stage, node, workload, first, last, geometry } = input;
  const policy = denseStagePolicySchema.parse(input.policy);
  if (policy.executionTarget === "cpu") {
    if (!Number.isSafeInteger(node.hostMemoryBytes) || node.hostMemoryBytes! <= geometry.hostHeadroomBytes
        || !Number.isSafeInteger(stage.layerStart) || !Number.isSafeInteger(stage.layerEnd)
        || stage.layerStart < 0 || stage.layerEnd <= stage.layerStart || stage.layerEnd > model.layers.length) return null;
    const scale = policy.precision === "float32" ? 2 : 1;
    const runtime = model.runtimeOverheadBytesPerStage + model.layers.slice(stage.layerStart, stage.layerEnd)
      .reduce((sum, layer) => sum + layer.kvBytesPerToken * workload.contextTokens * workload.concurrentSequences, 0);
    const required = stageMemoryBytes(model, stage, workload, first, last) * scale
      + geometry.hostScratchBytes + Math.max(0, policy.activationReserveBytes - runtime);
    const ceiling = Math.min(policy.hostRamBudgetBytes, node.hostMemoryBytes! - geometry.hostHeadroomBytes);
    return Number.isSafeInteger(required) && required > 0 && required <= ceiling
      ? { ...structuredClone(policy), hostRamBudgetBytes: required, vramBudgetBytes: 0 } : null;
  }
  if (policy.memoryMode === "resident") {
    if (!Number.isSafeInteger(stage.layerStart) || !Number.isSafeInteger(stage.layerEnd)
        || stage.layerStart < 0 || stage.layerEnd <= stage.layerStart || stage.layerEnd > model.layers.length
        || typeof node.deviceMemorySharesHost !== "boolean"
        || !Number.isSafeInteger(node.hostMemoryBytes)) return null;
    const scale = policy.precision === "float32" ? 2 : 1;
    const runtime = model.runtimeOverheadBytesPerStage + model.layers.slice(stage.layerStart, stage.layerEnd)
      .reduce((sum, layer) => sum + layer.kvBytesPerToken * workload.contextTokens * workload.concurrentSequences, 0);
    const complete = stageMemoryBytes(model, stage, workload, first, last) * scale;
    const staging = denseHostStagingBytes(model, { ...stage, dense: policy }, scale);
    if (staging === null) return null;
    const graphics = complete + geometry.graphicsStaticOverheadBytes
      + Math.max(0, policy.activationReserveBytes - runtime);
    const host = complete + geometry.hostScratchBytes + staging
      + (node.deviceMemorySharesHost ? graphics : 0);
    return [host, graphics].every(bytes => Number.isSafeInteger(bytes) && bytes > 0)
      && host <= Math.min(policy.hostRamBudgetBytes, node.hostMemoryBytes! - geometry.hostHeadroomBytes)
      && graphics <= Math.min(policy.vramBudgetBytes, node.memoryBytes - node.reserveBytes)
      ? { ...structuredClone(policy), hostRamBudgetBytes: host, vramBudgetBytes: graphics } : null;
  }
  if (policy.memoryMode !== "bounded" || !policy.retainLayerPrefix
      || (policy.hostTokenLookup && (!first || model.tiedEmbeddingAndHead))
      || typeof node.deviceMemorySharesHost !== "boolean"
      || !Number.isSafeInteger(node.hostMemoryBytes) || node.hostMemoryBytes! <= geometry.hostHeadroomBytes) return null;
  const scale = policy.precision === "float32" ? 2 : 1;
  const layers = model.layers.slice(stage.layerStart, stage.layerEnd);
  const endpoint = first && last && model.tiedEmbeddingAndHead
    ? Math.max(model.embeddingBytes, model.lmHeadBytes)
    : (first && !policy.hostTokenLookup ? model.embeddingBytes : 0) + (last ? model.lmHeadBytes : 0);
  const stagingBytes = denseHostStagingBytes(model, { ...stage, dense: policy }, scale);
  if (stagingBytes === null) return null;
  const budget = planDenseCacheBudget({
    hostAvailableBytes: Math.min(policy.hostRamBudgetBytes, node.hostMemoryBytes! - geometry.hostHeadroomBytes),
    graphicsAvailableBytes: Math.min(policy.vramBudgetBytes, node.memoryBytes - node.reserveBytes),
    deviceMemorySharesHost: node.deviceMemorySharesHost,
    hostWeightBytes: stageMemoryBytes(model, stage, workload, first, last) * scale,
    hostScratchBytes: geometry.hostScratchBytes + stagingBytes, hostActivationBytes: 0,
    graphicsStaticWeightBytes: endpoint * scale + geometry.graphicsStaticOverheadBytes,
    // The complete host envelope already includes runtime/KV storage. Preserve
    // the certified accelerator reserve; normal dense admission still checks
    // the resulting policy against the full model's graphics geometry.
    graphicsActivationBytes: policy.activationReserveBytes,
    layerWeightBytes: layers.map(layer => layer.weightBytes * scale),
  });
  return budget ? { ...structuredClone(policy), hostRamBudgetBytes: budget.hostBudgetBytes,
    vramBudgetBytes: budget.graphicsBudgetBytes } : null;
}

