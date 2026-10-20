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
 * Contrato de `evaluateDistributionPlan` ante `workload.batchWindowMs`.
 *
 * `batchWindowMs` es un presupuesto de tiempo (milisegundos de espera por lote)
 * cuyo contrato externo es no negativo y finito: `runtime-manifest.validatePlanRequest`
 * aplica `assertNonNegativeFinite` (`runtime_workload_batch_window_is_invalid`) y el
 * launcher python / el CLI macro-wave lo validan como `nonNegativeFinite`. No es un
 * contador, así que no debe tratarse como un entero positivo cualquiera.
 *
 * Sin guard, un llamador sin validar podía pasar un valor límite y aun así obtener
 * `feasible:true` con tiempos fabricados: con un `batchWindowMs` negativo el
 * `batchingDelay` era negativo, de modo que `tpotMs` y `ttftMs` salían NEGATIVOS y
 * `aggregateTokensPerSecond` negativo (imposible físicamente); con `NaN`/`Infinity`
 * todas las métricas de tiempo quedaban no finitas sin descartar el plan. El coste
 * debe fallar CERRADO con `batch_window_ms_must_be_non_negative_and_finite`; para un
 * presupuesto válido (incluido 0) no cambia nada.
 */
describe("cost-model: batchWindowMs inválido falla cerrado", () => {
  it("declara infactible un batchWindowMs negativo, NaN o infinito", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const plan = twoStagePlan();
    for (const batchWindowMs of [
      -1,
      -0.0001,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const label = `batchWindowMs=${batchWindowMs}`;
      const metrics = evaluateDistributionPlan(
        model,
        topology,
        smallWorkload(batchWindowMs),
        plan,
      );
      expect(metrics.feasible, label).toBe(false);
      expect(metrics.infeasibleReason, label).toBe(
        "batch_window_ms_must_be_non_negative_and_finite",
      );
      // El plan infactible no fabrica métricas: no devuelve tiempos negativos.
      expect(metrics.ttftMs, label).toBe(Number.POSITIVE_INFINITY);
      expect(metrics.aggregateTokensPerSecond, label).toBe(0);
      expect(distributionObjective(metrics, WEIGHTS), label).toBe(
        Number.POSITIVE_INFINITY,
      );
    }
  });

  it("conserva tiempos positivos y throughput finito con batchWindowMs válido", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const plan = twoStagePlan();
    for (const batchWindowMs of [0, 0.5, 10]) {
      const label = `batchWindowMs=${batchWindowMs}`;
      const metrics = evaluateDistributionPlan(
        model,
        topology,
        smallWorkload(batchWindowMs),
        plan,
      );
      expect(metrics.feasible, label).toBe(true);
      expect(metrics.infeasibleReason, label).toBeNull();
      expect(metrics.tpotMs, label).toBeGreaterThan(0);
      expect(metrics.ttftMs, label).toBeGreaterThan(0);
      expect(
        Number.isFinite(metrics.aggregateTokensPerSecond),
        label,
      ).toBe(true);
      expect(metrics.aggregateTokensPerSecond, label).toBeGreaterThan(0);
      expect(
        Number.isFinite(distributionObjective(metrics, WEIGHTS)),
        label,
      ).toBe(true);
    }
  });
});

const WEIGHTS = {
  tpot: 1,
  ttft: 1,
  response: 1,
  energy: 1,
  unavailability: 1,
};

function smallModel(): DistributedModelProfile {
  return {
    id: "autonomy-batch-window",
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
    algorithm: "autonomy-batch-window",
    codec: "fp16",
    microBatchSize: 2,
    prefillChunkTokens: 16,
    stages: [
      { nodeId: "n0", layerStart: 0, layerEnd: 1 },
      { nodeId: "n1", layerStart: 1, layerEnd: 2 },
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
    batchGain: 1,
    maxBatchSpeedup: 4,
    powerWatts: 50,
    availability: 1,
  };
}

function smallWorkload(batchWindowMs: number): DistributionWorkload {
  return {
    promptTokens: 8,
    outputTokens: 4,
    contextTokens: 16,
    concurrentSequences: 2,
    maxStages: 2,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0.5,
    batchWindowMs,
    p95: true,
  };
}
