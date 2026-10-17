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
 * Contrato de `evaluateDistributionPlan` ante el resto de enteros positivos
 * requeridos (workload: `promptTokens`, `outputTokens`, `contextTokens`,
 * `maxStages`; plan: `microBatchSize`, `prefillChunkTokens`). Comparten el
 * contrato de `concurrentSequences` (`assertPositiveInteger` en runtime-manifest
 * y `z.number().int().positive()` en auto-distribute).
 *
 * Un llamador sin validar podía pasar valores límite y aun así obtener
 * `feasible:true` con métricas fabricadas: con `promptTokens = 0` se reportaba un
 * TTFT positivo para un prompt vacío, con `contextTokens = 0` desaparecía el
 * término KV y una ruta que no cabe se admitía, y los valores no finitos
 * envenenaban cada métrica. El coste debe fallar CERRADO con el motivo
 * `<campo>_must_be_a_positive_integer`; para entradas válidas no cambia nada.
 */
describe("cost-model: entradas límite fallan cerrado", () => {
  it("declara infactible cualquier campo del workload no entero positivo", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const plan = twoStagePlan();
    const fields: Array<[keyof DistributionWorkload, string]> = [
      ["promptTokens", "prompt_tokens_must_be_a_positive_integer"],
      ["outputTokens", "output_tokens_must_be_a_positive_integer"],
      ["contextTokens", "context_tokens_must_be_a_positive_integer"],
      ["maxStages", "max_stages_must_be_a_positive_integer"],
    ];

    for (const [name, reason] of fields) {
      for (const invalid of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const label = `${String(name)}=${invalid}`;
        const metrics = evaluateDistributionPlan(
          model,
          topology,
          smallWorkload({ [name]: invalid } as Partial<DistributionWorkload>),
          plan,
        );
        expect(metrics.feasible, label).toBe(false);
        expect(metrics.infeasibleReason, label).toBe(reason);
        expect(metrics.energyWhPerOutputToken, label).toBe(
          Number.POSITIVE_INFINITY,
        );
        expect(distributionObjective(metrics, WEIGHTS), label).toBe(
          Number.POSITIVE_INFINITY,
        );
      }
    }
  });

  it("declara infactible cualquier campo del plan no entero positivo", () => {
    const model = smallModel();
    const topology = twoNodeTopology();
    const fields: Array<[keyof DistributionPlan, string]> = [
      ["microBatchSize", "micro_batch_size_must_be_a_positive_integer"],
      ["prefillChunkTokens", "prefill_chunk_tokens_must_be_a_positive_integer"],
    ];

    for (const [name, reason] of fields) {
      for (const invalid of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        const label = `${String(name)}=${invalid}`;
        const metrics = evaluateDistributionPlan(
          model,
          topology,
          smallWorkload(),
          twoStagePlan({ [name]: invalid } as Partial<DistributionPlan>),
        );
        expect(metrics.feasible, label).toBe(false);
        expect(metrics.infeasibleReason, label).toBe(reason);
      }
    }
  });

  it("resuelve por el primer campo inválido en orden determinista", () => {
    const metrics = evaluateDistributionPlan(
      smallModel(),
      twoNodeTopology(),
      smallWorkload({ promptTokens: 0, outputTokens: 0 }),
      twoStagePlan({ microBatchSize: 0 }),
    );
    expect(metrics.infeasibleReason).toBe(
      "prompt_tokens_must_be_a_positive_integer",
    );
  });

  it("conserva el plan factible con todos los enteros positivos válidos", () => {
    const metrics = evaluateDistributionPlan(
      smallModel(),
      twoNodeTopology(),
      smallWorkload(),
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

function smallModel(): DistributedModelProfile {
  return {
    id: "autonomy-boundary-inputs",
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

function twoStagePlan(overrides: Partial<DistributionPlan> = {}): DistributionPlan {
  return {
    algorithm: "autonomy-boundary-inputs",
    codec: "fp16",
    microBatchSize: 1,
    prefillChunkTokens: 16,
    stages: [
      { nodeId: "n0", layerStart: 0, layerEnd: 1 },
      { nodeId: "n1", layerStart: 1, layerEnd: 2 },
    ],
    ...overrides,
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

function smallWorkload(
  overrides: Partial<DistributionWorkload> = {},
): DistributionWorkload {
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
    ...overrides,
  };
}
