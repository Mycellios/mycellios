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
 * Contrato de `evaluateDistributionPlan` ante `concurrentSequences`.
 *
 * El runtime exige una concurrencia entera positiva:
 * `runtime-manifest.validatePlanRequest` aplica `assertPositiveInteger` y lanza
 * `runtime_workload_concurrent_sequences_is_invalid`, y el esquema de
 * auto-distribución usa `z.number().int().positive()`. Por eso la vía validada
 * nunca llega aquí con un valor inválido.
 *
 * Ante una entrada inválida (cero, negativa, fraccionaria, `NaN` o infinita) el
 * coste debe fallar CERRADO: declarar el plan infactible. Sin el guard, el valor
 * no se rechazaría: con concurrencia 0 el cálculo daría `batchesPerRound = 0` y
 * `energyWhPerOutputToken = (energyPerBatchWh * 0) / 0 = NaN`, con
 * `aggregateTokensPerSecond = 0`, y el plan seguiría marcado `feasible:true`;
 * entonces `distributionObjective` (que solo corta si `!metrics.feasible`)
 * devolvería `NaN` en vez de descartar la entrada; los valores fraccionarios o
 * negativos darían una energía positiva finita igualmente engañosa. El guard lo
 * evita declarándolo infactible, de modo que la métrica queda no finita
 * (`Number.POSITIVE_INFINITY`) como el resto de un plan descartado. Para
 * entradas válidas los resultados no cambian.
 */
describe("cost-model: concurrencia inválida falla cerrado", () => {
  it("declara infactible cualquier concurrencia que no sea entero positivo", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const plan = twoStagePlan();

    for (const concurrentSequences of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const metrics = evaluateDistributionPlan(
        model,
        topology,
        smallWorkload(concurrentSequences),
        plan,
      );
      const label = `concurrentSequences=${concurrentSequences}`;
      expect(metrics.feasible, label).toBe(false);
      expect(metrics.infeasibleReason, label).toBe(
        "concurrent_sequences_must_be_a_positive_integer",
      );
      // El plan infactible no fabrica métricas: la energía queda no finita
      // (`Number.POSITIVE_INFINITY`) como el resto del plan descartado.
      expect(metrics.energyWhPerOutputToken, label).toBe(
        Number.POSITIVE_INFINITY,
      );
      expect(
        distributionObjective(metrics, objectiveWeights()),
        label,
      ).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("conserva la energía positiva cuando hay trabajo real", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const plan = twoStagePlan();

    for (const concurrentSequences of [1, 4]) {
      const active = evaluateDistributionPlan(
        model,
        topology,
        smallWorkload(concurrentSequences),
        plan,
      );
      expect(active.feasible, `concurrentSequences=${concurrentSequences}`).toBe(
        true,
      );
      expect(
        Number.isFinite(active.energyWhPerOutputToken),
        `concurrentSequences=${concurrentSequences}`,
      ).toBe(true);
      expect(
        active.energyWhPerOutputToken,
        `concurrentSequences=${concurrentSequences}`,
      ).toBeGreaterThan(0);
      expect(
        Number.isFinite(distributionObjective(active, objectiveWeights())),
        `concurrentSequences=${concurrentSequences}`,
      ).toBe(true);
    }
  });
});

function objectiveWeights(): {
  tpot: number;
  ttft: number;
  response: number;
  energy: number;
  unavailability: number;
} {
  return { tpot: 1, ttft: 1, response: 1, energy: 1, unavailability: 1 };
}

function smallModel(): DistributedModelProfile {
  return {
    id: "autonomy-zero-concurrency-energy",
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
    algorithm: "autonomy-zero-concurrency",
    codec: "fp16",
    microBatchSize: 1,
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
    batchGain: 0,
    maxBatchSpeedup: 1,
    powerWatts: 50,
    availability: 1,
  };
}

function smallWorkload(concurrentSequences: number): DistributionWorkload {
  return {
    promptTokens: 8,
    outputTokens: 4,
    contextTokens: 16,
    concurrentSequences,
    maxStages: 2,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0.5,
    batchWindowMs: 0,
    p95: true,
  };
}
