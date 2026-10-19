import { describe, expect, it } from "vitest";
import {
  distributionObjective,
  evaluateDistributionPlan,
} from "../src/distribution/cost-model.js";
import type {
  ComputeNodeProfile,
  DistributedModelProfile,
  DistributionPlan,
  DistributionTopology,
  DistributionWorkload,
} from "../src/distribution/types.js";

/**
 * Contrato de `evaluateDistributionPlan` ante límites de capa fraccionarios en
 * `plan.stages[].layerStart`/`layerEnd`. El runtime (`runtime-manifest`
 * `validatePlanRequest`) rechaza esos límites con `asInteger` bajo el motivo de
 * cobertura contigua (`runtime_layers_are_not_contiguous`); aquí, un llamador
 * sin validar podía pasar una etapa como `[0, 0.5)` que `validContiguousCoverage`
 * aceptaba (0, 0.5, 0.5, 2 suman cobertura exacta) y luego indexar
 * `model.layers[-0.5]` en `undefined`, lanzando un TypeError en lugar de fallar
 * cerrado. El coste debe rechazar la entrada con el MISMO motivo de cobertura
 * (`layers_are_not_covered_exactly_once`), sin cambiar fórmulas ni contratos.
 */
describe("cost-model: límites de capa fraccionarios fallan cerrado", () => {
  it("rechaza una etapa con límites fraccionarios [0, 0.5) y su continuación [0.5, 2)", () => {
    const metrics = evaluateDistributionPlan(
      twoLayerModel(),
      twoNodeTopology(),
      workload(),
      planWithFractionalStages(),
    );
    expect(metrics.feasible).toBe(false);
    expect(metrics.infeasibleReason).toBe("layers_are_not_covered_exactly_once");
    expect(metrics.energyWhPerOutputToken).toBe(Number.POSITIVE_INFINITY);
    expect(distributionObjective(metrics, WEIGHTS)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("rechaza cualquier límite de capa no entero sin lanzar", () => {
    const plan = twoStagePlan();
    const variants: Array<Partial<DistributionPlan["stages"][number]>> = [
      { layerStart: 0.5 },
      { layerEnd: 1.5 },
      { layerStart: Number.NaN },
      { layerEnd: Number.POSITIVE_INFINITY },
      { layerEnd: Number.NEGATIVE_INFINITY },
    ];
    for (const variant of variants) {
      const stages = plan.stages.map((stage, index) =>
        index === 1 ? { ...stage, ...variant } : stage,
      );
      const metrics = evaluateDistributionPlan(
        twoLayerModel(),
        twoNodeTopology(),
        workload(),
        { ...plan, stages },
      );
      expect(metrics.feasible, JSON.stringify(variant)).toBe(false);
      expect(
        metrics.infeasibleReason,
        JSON.stringify(variant),
      ).toBe("layers_are_not_covered_exactly_once");
    }
  });

  it("conserva el plan factible con límites enteros de cobertura exacta", () => {
    const metrics = evaluateDistributionPlan(
      twoLayerModel(),
      twoNodeTopology(),
      workload(),
      twoStagePlan(),
    );
    expect(metrics.feasible).toBe(true);
    expect(metrics.infeasibleReason).toBeNull();
    expect(Number.isFinite(metrics.ttftMs)).toBe(true);
    expect(Number.isFinite(metrics.energyWhPerOutputToken)).toBe(true);
    expect(Number.isFinite(distributionObjective(metrics, WEIGHTS))).toBe(true);
  });
});

const WEIGHTS = {
  tpot: 1,
  ttft: 1,
  response: 1,
  energy: 1,
  unavailability: 1,
};

function twoLayerModel(): DistributedModelProfile {
  return {
    id: "autonomy-fractional-layer-bounds",
    layers: [
      {
        index: 0,
        weightBytes: 1_024,
        activationElements: 64,
        kvBytesPerToken: 4,
        decodeMsAtUnit: 1,
        prefillMsPerTokenAtUnit: 0.01,
      },
      {
        index: 1,
        weightBytes: 1_024,
        activationElements: 64,
        kvBytesPerToken: 4,
        decodeMsAtUnit: 1,
        prefillMsPerTokenAtUnit: 0.01,
      },
    ],
    embeddingBytes: 1_024,
    lmHeadBytes: 1_024,
    runtimeOverheadBytesPerStage: 0,
    embeddingDecodeMsAtUnit: 0.1,
    lmHeadDecodeMsAtUnit: 0.1,
    embeddingPrefillMsPerTokenAtUnit: 0.01,
    lmHeadPrefillMsPerTokenAtUnit: 0.01,
  };
}

function twoStagePlan(): DistributionPlan {
  return {
    algorithm: "autonomy-fractional-layer-bounds",
    codec: "fp16",
    microBatchSize: 1,
    prefillChunkTokens: 16,
    stages: [
      { nodeId: "n0", layerStart: 0, layerEnd: 1 },
      { nodeId: "n1", layerStart: 1, layerEnd: 2 },
    ],
  };
}

function planWithFractionalStages(): DistributionPlan {
  return {
    ...twoStagePlan(),
    stages: [
      { nodeId: "n0", layerStart: 0, layerEnd: 0.5 },
      { nodeId: "n1", layerStart: 0.5, layerEnd: 2 },
    ],
  };
}

function twoNodeTopology(): DistributionTopology {
  const nodes: ComputeNodeProfile[] = [costNode("n0"), costNode("n1")];
  const links = nodes.flatMap((from) =>
    nodes
      .filter((to) => to.id !== from.id)
      .map((to) => ({
        from: from.id,
        to: to.id,
        oneWayLatencyMs: 1,
        jitterP95Ms: 0,
        bandwidthMbps: 1_000,
        lossRate: 0,
        availability: 1,
      })),
  );
  return { nodes, links };
}

function costNode(id: string): ComputeNodeProfile {
  return {
    id,
    region: "autonomy",
    memoryBytes: 100 * 1024 * 1024,
    reserveBytes: 0,
    decodeScale: 1,
    prefillScale: 1,
    codecScale: 1,
    batchGain: 0,
    maxBatchSpeedup: 1,
    powerWatts: 50,
    availability: 1,
  };
}

function workload(): DistributionWorkload {
  return {
    promptTokens: 8,
    outputTokens: 4,
    contextTokens: 16,
    concurrentSequences: 2,
    maxStages: 2,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0.5,
    batchWindowMs: 0,
    p95: true,
  };
}
