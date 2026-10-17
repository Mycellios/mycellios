import { describe, expect, it } from "vitest";
import { evaluateDistributionPlan, stageMemoryBytes } from "../src/distribution/cost-model.js";
import {
  DEFAULT_SEARCH_OPTIONS,
  OrderedDynamicProgrammingPlanner,
  ProportionalComputePlanner,
  TopologyBeamPlanner,
} from "../src/distribution/planners.js";
import type {
  ComputeNodeProfile,
  DistributedModelProfile,
  DistributionPlan,
  DistributionTopology,
  DistributionWorkload,
} from "../src/distribution/types.js";

/**
 * Regresión: `proportionalPlacement` medía la capacidad de cada nodo desde la
 * capa 0, pero los tramos no pesan igual. Con capas intermedias más pesadas que
 * la primera daba capas que no cabían desde el inicio real del tramo; el modelo
 * de coste rechazaba el plan y `compute-proportional` devolvía `null` aunque
 * existiera un reparto válido con esos mismos nodos en ese mismo orden. Caso: 4
 * capas de 1, 9, 9 y 12 KiB; el nodo estrecho (18 KiB) sólo aguanta desde la
 * capa 3, así que su capacidad real es 1, no 2 como parecía desde la capa 0.
 */
describe("planificador compute-proportional: capacidad desde el inicio real del tramo", () => {
  it("no pierde la ruta válida cuando las capas no pesan igual", () => {
    const model = unevenModel();
    const topology = pairTopology();
    const workload = smallWorkload(2);

    const proportional = new ProportionalComputePlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );

    expect(
      proportional,
      "compute-proportional debe devolver una ruta: existe un reparto que respeta la memoria desde el inicio real de cada tramo",
    ).not.toBeNull();
    expect(evaluateDistributionPlan(model, topology, workload, proportional!).feasible).toBe(true);
    expectRespectsRealMemory(proportional!, model, topology, workload);
  });

  it("la instancia no es imposible: la resuelven los otros planificadores", () => {
    const model = unevenModel();
    const topology = pairTopology();
    const workload = smallWorkload(2);

    for (const planner of [
      new OrderedDynamicProgrammingPlanner(DEFAULT_SEARCH_OPTIONS),
      new TopologyBeamPlanner(DEFAULT_SEARCH_OPTIONS),
    ]) {
      const plan = planner.plan(model, topology, workload);
      expect(plan, `${planner.id} debe encontrar la ruta`).not.toBeNull();
      expect(evaluateDistributionPlan(model, topology, workload, plan!).feasible).toBe(true);
      expectRespectsRealMemory(plan!, model, topology, workload);
    }
  });
});

function expectRespectsRealMemory(
  plan: DistributionPlan,
  model: DistributedModelProfile,
  topology: DistributionTopology,
  workload: DistributionWorkload,
): void {
  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  let nextLayer = 0;
  plan.stages.forEach((stage, index) => {
    const node = nodeById.get(stage.nodeId)!;
    expect(node).toBeDefined();
    // Cobertura contigua y exacta de todas las capas.
    expect(stage.layerStart).toBe(nextLayer);
    nextLayer = stage.layerEnd;

    if (node.maxStageLayers !== undefined) {
      expect(stage.layerEnd - stage.layerStart).toBeLessThanOrEqual(node.maxStageLayers);
    }
    // La memoria se comprueba desde la capa donde el tramo empieza de verdad.
    const memory = stageMemoryBytes(
      model,
      stage,
      workload,
      index === 0,
      index === plan.stages.length - 1,
    );
    expect(
      memory,
      `el tramo ${stage.nodeId}:${stage.layerStart}-${stage.layerEnd} no cabe desde su inicio real`,
    ).toBeLessThanOrEqual(node.memoryBytes - node.reserveBytes);
  });
  expect(nextLayer).toBe(model.layers.length);
}

const KIB = 1024;

function unevenModel(): DistributedModelProfile {
  return {
    id: "autonomy-proportional-start-capacity",
    layers: [1, 9, 9, 12].map((weightKiB, index) => ({
      index,
      weightBytes: weightKiB * KIB,
      activationElements: 64,
      kvBytesPerToken: 4,
      decodeMsAtUnit: 1,
      prefillMsPerTokenAtUnit: 0.01,
    })),
    embeddingBytes: KIB,
    lmHeadBytes: KIB,
    runtimeOverheadBytesPerStage: 0,
    embeddingDecodeMsAtUnit: 0.1,
    lmHeadDecodeMsAtUnit: 0.1,
    embeddingPrefillMsPerTokenAtUnit: 0.01,
    lmHeadPrefillMsPerTokenAtUnit: 0.01,
  };
}

function pairTopology(): DistributionTopology {
  const nodes: ComputeNodeProfile[] = [
    node("wide-tail", {
      memoryBytes: 43 * KIB,
      decodeScale: 2.4611536553595217,
      prefillScale: 1.6963912260718643,
      maxStageLayers: 3,
      stageRoles: ["head", "tail"],
    }),
    node("narrow-tail", {
      memoryBytes: 18 * KIB,
      decodeScale: 2.936874377820641,
      prefillScale: 0.7319458206649869,
      stageRoles: ["tail"],
    }),
  ];
  return {
    nodes,
    links: nodes.flatMap((from) =>
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
    ),
  };
}

function node(
  id: string,
  overrides: Partial<ComputeNodeProfile> = {},
): ComputeNodeProfile {
  return {
    id,
    region: "autonomy",
    memoryBytes: 4 * KIB,
    reserveBytes: 0,
    decodeScale: 1,
    prefillScale: 1,
    codecScale: 1,
    batchGain: 0,
    maxBatchSpeedup: 1,
    powerWatts: 50,
    availability: 1,
    ...overrides,
  };
}

function smallWorkload(maxStages: number): DistributionWorkload {
  return {
    promptTokens: 16,
    outputTokens: 8,
    contextTokens: 32,
    concurrentSequences: 1,
    maxStages,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0.5,
    batchWindowMs: 0,
    p95: true,
  };
}
