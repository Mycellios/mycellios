import { describe, expect, it } from "vitest";
import { evaluateDistributionPlan } from "../src/distribution/cost-model.js";
import {
  DEFAULT_SEARCH_OPTIONS,
  TopologyBeamPlanner,
  VramGreedyPlanner,
} from "../src/distribution/planners.js";
import type {
  ComputeNodeProfile,
  DistributedModelProfile,
  DistributionPlan,
  DistributionTopology,
  DistributionWorkload,
} from "../src/distribution/types.js";

/**
 * Regresión: `VramGreedyPlanner` elegía qué nodo ocupa cada posición de la
 * pipeline mirando sólo memoria y techo de capas (`furthestLayerThatFits`),
 * pero no el rol certificado del runtime (`stageRoles`). El modelo de coste sí
 * lo aplica (`engine_stage_role_unsupported`), así que el planificador devolvía
 * un reparto que después se rechazaba entero.
 *
 * Consecuencia: como la primera etapa es la cabeza y la última la cola, bastaba
 * con que el nodo de más memoria no certificara `head` (o `tail`) para que el
 * greedy devolviera `null` aunque existiera una ruta válida con esos mismos
 * nodos. `topology-beam` la encuentra, lo que demuestra que la instancia no era
 * imposible y que el defecto era la selección de posiciones del greedy.
 */
describe("planificador vram-greedy: roles de etapa certificados", () => {
  it("no entrega la cabeza a un nodo que sólo certifica cola", () => {
    const model = smallModel(2);
    // El nodo de más memoria es `tail`, así que no puede abrir la pipeline.
    const topology = mesh([
      node("big-tail", { memoryBytes: 8 * MIB, stageRoles: ["tail"] }),
      node("head", { memoryBytes: 4 * MIB, stageRoles: ["head", "middle"] }),
      node("small-tail", { memoryBytes: 2 * MIB, stageRoles: ["tail"] }),
    ]);
    const workload = smallWorkload(3);

    const greedy = new VramGreedyPlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );

    expect(
      greedy,
      "vram-greedy debe devolver una ruta: existe un reparto que respeta stageRoles",
    ).not.toBeNull();
    expectRespectsStageRoles(greedy!, model, topology, workload);
    expect(greedy!.stages[0]!.nodeId).toBe("head");
  });

  it("no cierra el modelo en un nodo que no puede ser cola", () => {
    const model = smallModel(2);
    // El nodo de más memoria puede ser cabeza o medio, pero nunca cola.
    const topology = mesh([
      node("big-head", { memoryBytes: 8 * MIB, stageRoles: ["head", "middle"] }),
      node("tail", { memoryBytes: 4 * MIB, stageRoles: ["tail"] }),
    ]);
    const workload = smallWorkload(2);

    const greedy = new VramGreedyPlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );

    expect(greedy).not.toBeNull();
    expectRespectsStageRoles(greedy!, model, topology, workload);
    expect(greedy!.stages.at(-1)!.nodeId).toBe("tail");
  });
});

function expectRespectsStageRoles(
  plan: DistributionPlan,
  model: DistributedModelProfile,
  topology: DistributionTopology,
  workload: DistributionWorkload,
): void {
  const metrics = evaluateDistributionPlan(model, topology, workload, plan);
  expect(metrics.feasible).toBe(true);

  const nodeById = new Map(topology.nodes.map((node) => [node.id, node]));
  let nextLayer = 0;
  plan.stages.forEach((stage, index) => {
    const node = nodeById.get(stage.nodeId);
    expect(node).toBeDefined();
    expect(
      supportsStagePosition(
        node!,
        index === 0,
        index === plan.stages.length - 1,
      ),
      `el nodo ${stage.nodeId} no certifica su posición en la pipeline`,
    ).toBe(true);
    // Cobertura contigua y exacta de todas las capas.
    expect(stage.layerStart).toBe(nextLayer);
    nextLayer = stage.layerEnd;
  });
  expect(nextLayer).toBe(model.layers.length);

  // La misma instancia es resoluble por el planificador general: el defecto era
  // la selección del greedy, no una instancia imposible.
  const beam = new TopologyBeamPlanner(DEFAULT_SEARCH_OPTIONS).plan(
    model,
    topology,
    workload,
  );
  expect(beam).not.toBeNull();
  expect(evaluateDistributionPlan(model, topology, workload, beam!).feasible).toBe(true);
}

function supportsStagePosition(
  node: ComputeNodeProfile,
  first: boolean,
  last: boolean,
): boolean {
  if (!node.stageRoles) return true;
  if (first && !node.stageRoles.includes("head")) return false;
  if (last && !node.stageRoles.includes("tail")) return false;
  return first || last || node.stageRoles.includes("middle");
}

const MIB = 1024 * 1024;

function node(
  id: string,
  overrides: Partial<ComputeNodeProfile> = {},
): ComputeNodeProfile {
  return {
    id,
    region: "autonomy",
    memoryBytes: 4 * MIB,
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

function mesh(nodes: ComputeNodeProfile[]): DistributionTopology {
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

function smallModel(layerCount: number): DistributedModelProfile {
  return {
    id: "autonomy-stage-role-selection",
    layers: Array.from({ length: layerCount }, (_, index) => ({
      index,
      weightBytes: 64 * 1024,
      activationElements: 64,
      kvBytesPerToken: 4,
      decodeMsAtUnit: 1,
      prefillMsPerTokenAtUnit: 0.01,
    })),
    embeddingBytes: 64 * 1024,
    lmHeadBytes: 64 * 1024,
    runtimeOverheadBytesPerStage: 0,
    embeddingDecodeMsAtUnit: 0.1,
    lmHeadDecodeMsAtUnit: 0.1,
    embeddingPrefillMsPerTokenAtUnit: 0.01,
    lmHeadPrefillMsPerTokenAtUnit: 0.01,
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
