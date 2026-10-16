import { describe, expect, it } from "vitest";
import { evaluateDistributionPlan } from "../src/distribution/cost-model.js";
import {
  DEFAULT_SEARCH_OPTIONS,
  OrderedDynamicProgrammingPlanner,
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
 * Regresión: `orderedDpPlacement` repartía capas sólo por coste y memoria, sin
 * respetar el techo de capas por etapa (`maxStageLayers`) que sí aplican el
 * resto de barridos (`furthestLayerThatFits`, `maximumLayerCount`,
 * `ExhaustiveTopologyPlanner` y el propio `evaluateDistributionPlan`).
 *
 * Como el coste prefería poner más capas en el nodo rápido, el DP devolvía un
 * reparto que el modelo de coste rechazaba después. El planificador descartaba
 * ese `count` y, al ser el único admisible, terminaba en `null`: declaraba
 * imposible una ruta que sí existe y que `topology-beam` encuentra.
 */
describe("planificador: techo de capas por etapa", () => {
  it("ordered-dp no pierde una ruta válida cuando el nodo barato tiene maxStageLayers menor", () => {
    const model = smallModel(3);
    const topology = twoNodeTopology();
    const workload = smallWorkload(2);

    // El nodo rápido (`fast`) es el primero por score, pero sólo puede ser
    // dueño de una capa. El reparto válido obliga a `slow` a cubrir el resto.
    const orderedDp = new OrderedDynamicProgrammingPlanner(
      DEFAULT_SEARCH_OPTIONS,
    ).plan(model, topology, workload);

    expect(
      orderedDp,
      "ordered-dp debe devolver una ruta: existe un reparto que respeta maxStageLayers",
    ).not.toBeNull();
    expectRespectsStageLayerCeiling(orderedDp!, model, topology, workload);

    // El mismo caso es resoluble por el planificador general: prueba de que la
    // instancia no era imposible y que el defecto era la búsqueda del DP.
    const beam = new TopologyBeamPlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );
    expect(beam).not.toBeNull();
    expectRespectsStageLayerCeiling(beam!, model, topology, workload);
  });
});

function expectRespectsStageLayerCeiling(
  plan: DistributionPlan,
  model: DistributedModelProfile,
  topology: DistributionTopology,
  workload: DistributionWorkload,
): void {
  const metrics = evaluateDistributionPlan(model, topology, workload, plan);
  expect(metrics.feasible).toBe(true);

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  for (const stage of plan.stages) {
    const node = nodeById.get(stage.nodeId)!;
    expect(node).toBeDefined();
    expect(stage.layerEnd - stage.layerStart).toBeLessThanOrEqual(
      node.maxStageLayers!,
    );
  }

  // Cobertura contigua y exacta de todas las capas.
  let nextLayer = 0;
  for (const stage of plan.stages) {
    expect(stage.layerStart).toBe(nextLayer);
    nextLayer = stage.layerEnd;
  }
  expect(nextLayer).toBe(model.layers.length);
}

function smallModel(layerCount: number): DistributedModelProfile {
  return {
    id: "autonomy-stage-layer-limit",
    layers: Array.from({ length: layerCount }, (_, index) => ({
      index,
      weightBytes: 1_024,
      activationElements: 64,
      kvBytesPerToken: 4,
      decodeMsAtUnit: 1,
      prefillMsPerTokenAtUnit: 0.01,
    })),
    embeddingBytes: 1_024,
    lmHeadBytes: 1_024,
    runtimeOverheadBytesPerStage: 0,
    embeddingDecodeMsAtUnit: 0.1,
    lmHeadDecodeMsAtUnit: 0.1,
    embeddingPrefillMsPerTokenAtUnit: 0.01,
    lmHeadPrefillMsPerTokenAtUnit: 0.01,
  };
}

function twoNodeTopology(): DistributionTopology {
  const nodes: ComputeNodeProfile[] = [
    constrainedNode("fast", 0.1, 1),
    constrainedNode("slow", 10, 3),
  ];
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

function constrainedNode(
  id: string,
  decodeScale: number,
  maxStageLayers: number,
): ComputeNodeProfile {
  return {
    id,
    region: "autonomy",
    memoryBytes: 100 * 1024 * 1024,
    reserveBytes: 0,
    decodeScale,
    prefillScale: decodeScale,
    codecScale: 1,
    batchGain: 0,
    maxBatchSpeedup: 1,
    powerWatts: 50,
    availability: 1,
    maxStageLayers,
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
