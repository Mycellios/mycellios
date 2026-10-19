import { describe, expect, it } from "vitest";
import { evaluateDistributionPlan } from "../src/distribution/cost-model.js";
import {
  DEFAULT_SEARCH_OPTIONS,
  ExhaustiveTopologyPlanner,
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
 * Regresión: el filtro optimista `canStillCoverRemainingLayers` del beam medía
 * la capacidad de cada nodo restante desde el mismo inicio de capas
 * (`nextLayer`). Pero las capas no pesan igual y cada etapa empieza donde acaba
 * la anterior: un nodo que sólo cabe donde las capas son ligeras parecía no
 * caber desde un inicio común con capas pesadas, el filtro subestimaba el total
 * y podaba la ruta.
 *
 * Consecuencia: `topology-beam` devolvía `null` aunque existiera una ruta válida
 * que `exhaustive-optimal` sí encuentra. El filtro debe ser optimista —jamás
 * descartar una ruta real— así que su cota para cada nodo es la mayor capacidad
 * desde cualquier inicio dentro del tramo restante.
 */
describe("planificador topology-beam: cota del filtro de cobertura restante", () => {
  it("no pierde la ruta válida cuando las capas ligeras están al final", () => {
    // Layer weights: 7,10,12,7,3,4,5 KiB.
    // n0 (mem 13) abre la cabeza con la capa 0; n2 (mem 30, head+middle) cubre
    // las capas pesadas 1..4; n4 (mem 16, middle+tail) cierra con las ligeras
    // 4..7. El filtro anterior medía la capacidad de n4 desde la capa 1 (capas
    // pesadas) y la subestimaba, por lo que el beam devolvía `null`.
    const model = smallModel();
    const topology = mesh([
      node("open-head", { memoryBytes: 13 * KIB }),
      node("narrow-middle", {
        memoryBytes: 2 * KIB,
        stageRoles: ["middle"],
        maxStageLayers: 7,
      }),
      node("heavy-middle", {
        memoryBytes: 30 * KIB,
        stageRoles: ["head", "middle"],
      }),
      node("tiny-middle", { memoryBytes: 3 * KIB, stageRoles: ["head", "middle"] }),
      node("light-tail", {
        memoryBytes: 16 * KIB,
        stageRoles: ["middle", "tail"],
      }),
    ]);
    const workload = smallWorkload(3);

    const beam = new TopologyBeamPlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );

    expect(
      beam,
      "topology-beam debe devolver una ruta: existe una cubierta válida con 3 etapas",
    ).not.toBeNull();
    expect(evaluateDistributionPlan(model, topology, workload, beam!).feasible).toBe(true);

    // La misma instancia la resuelve el planificador exhaustivo: prueba de que
    // no era imposible y de que el defecto estaba en la poda del beam.
    const exhaustive = new ExhaustiveTopologyPlanner(DEFAULT_SEARCH_OPTIONS).plan(
      model,
      topology,
      workload,
    );
    expect(exhaustive).not.toBeNull();
    expect(evaluateDistributionPlan(model, topology, workload, exhaustive!).feasible).toBe(true);
  });
});

function smallModel(): DistributedModelProfile {
  return {
    id: "autonomy-beam-remaining-coverage",
    layers: [7, 10, 12, 7, 3, 4, 5].map((weightKiB, index) => ({
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

const KIB = 1024;

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
