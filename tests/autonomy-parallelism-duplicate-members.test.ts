import { describe, expect, it } from "vitest";
import {
  compareParallelismArchitectures,
  tensorParallelCellGateReason,
} from "../src/distribution/parallelism.js";
import type {
  ComputeNodeProfile,
  DirectedLinkProfile,
  DistributedModelProfile,
  DistributionPlan,
  DistributionTopology,
  DistributionWorkload,
} from "../src/distribution/types.js";

/**
 * Regresión: una celda de paralelismo tensorial reutilizaba el mismo nodo
 * físico como si fueran dos rangos distintos.
 *
 * `compareParallelismArchitectures` deriva los identificadores de nodo de las
 * etapas del plan de tubería. Si el plan repite un nodo (algo que el modelo de
 * coste ya rechaza como `node_reused_in_route`), `tensorParallelEstimate`
 * seguía adelante: la admisión física `tensorParallelCellGateReason` recorría
 * los pares ordenados y se saltaba los pares `from === to`, de modo que no
 * verificaba ningún enlace; después `directedLink` sintetiza un enlace propio
 * de coste cero y `tensorShardFits` repartía la memoria entre un número de
 * rangos inflado. El resultado era una estimación `tensor-ring`/`tensor-star`
 * `feasible:true` con colectivos a coste cero y una aceleración fabricada que
 * ninguna topología física puede ejecutar.
 *
 * El arreglo es una comprobación de pertenencia en la puerta de admisión: como
 * `tensorParallelEstimate` pasa por ella, la celda con miembros repetidos queda
 * infactible con `tp_cell_member_reused`. Las estrategias (`tensor-ring`,
 * `tensor-star`, etc.) y su significado no cambian; una celda con nodos
 * distintos sigue admitiéndose igual que antes.
 */
describe("paralelismo: celda tensorial con miembros repetidos", () => {
  it("la puerta rechaza identificadores de miembro repetidos", () => {
    const { topology } = scenario();
    const now = Date.now();

    expect(tensorParallelCellGateReason(["a", "a"], topology, now)).toBe(
      "tp_cell_member_reused",
    );
    expect(tensorParallelCellGateReason(["a", "b", "b"], topology, now)).toBe(
      "tp_cell_member_reused",
    );
    // Sin repeticiones la admisión no cambia.
    expect(tensorParallelCellGateReason(["a", "b"], topology, now)).toBeNull();
  });

  it("no fabrica una estimación tensorial cuando el plan reutiliza un nodo", () => {
    const { model, topology, workload } = scenario();
    const reused: DistributionPlan = {
      algorithm: "autonomy-parallelism-duplicate-members",
      codec: "fp16",
      microBatchSize: 1,
      prefillChunkTokens: 16,
      // Dos etapas sobre el mismo nodo físico `a`: ruta inválida.
      stages: [
        { nodeId: "a", layerStart: 0, layerEnd: 4 },
        { nodeId: "a", layerStart: 4, layerEnd: 8 },
      ],
    };

    const estimates = compareParallelismArchitectures(
      model,
      topology,
      workload,
      reused,
    );

    // La ruta secuencial ya se rechazaba; la novedad es que las tensor-parallel
    // dejan de colarse con un coste de colectivo cero.
    const contiguous = estimates.find(
      (entry) => entry.architecture === "contiguous-pipeline",
    )!;
    expect(contiguous.feasible).toBe(false);
    expect(contiguous.reason).toBe("node_reused_in_route");

    for (const architecture of ["tensor-ring", "tensor-star"] as const) {
      const estimate = estimates.find(
        (entry) => entry.architecture === architecture,
      )!;
      expect(estimate.feasible, architecture).toBe(false);
      expect(estimate.reason, architecture).toBe("tp_cell_member_reused");
      expect(estimate.tpotMs, architecture).toBe(Number.POSITIVE_INFINITY);
    }

    // Las demás estrategias conservan su significado: en este escenario el
    // modelo sí cabe en un único nodo.
    const single = estimates.find(
      (entry) => entry.architecture === "single-device",
    )!;
    expect(single.feasible).toBe(true);
    expect(Number.isFinite(single.tpotMs)).toBe(true);
  });

  it("sigue admitiendo una celda válida con nodos distintos", () => {
    const { model, topology, workload } = scenario();
    const valid: DistributionPlan = {
      algorithm: "autonomy-parallelism-distinct-members",
      codec: "fp16",
      microBatchSize: 1,
      prefillChunkTokens: 16,
      stages: [
        { nodeId: "a", layerStart: 0, layerEnd: 4 },
        { nodeId: "b", layerStart: 4, layerEnd: 8 },
      ],
    };

    const estimates = compareParallelismArchitectures(
      model,
      topology,
      workload,
      valid,
    );
    for (const architecture of ["tensor-ring", "tensor-star"] as const) {
      const estimate = estimates.find(
        (entry) => entry.architecture === architecture,
      )!;
      expect(estimate.feasible, architecture).toBe(true);
      expect(estimate.reason, architecture).toBeNull();
      expect(Number.isFinite(estimate.tpotMs), architecture).toBe(true);
    }
  });
});

function scenario(): {
  model: DistributedModelProfile;
  topology: DistributionTopology;
  workload: DistributionWorkload;
} {
  const model: DistributedModelProfile = {
    id: "autonomy-parallelism-duplicate-members",
    layers: Array.from({ length: 8 }, (_, index) => ({
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
  const nodes: ComputeNodeProfile[] = [cellNode("a"), cellNode("b")];
  const topology: DistributionTopology = {
    nodes,
    links: [probedLink("a", "b"), probedLink("b", "a")],
  };
  const workload: DistributionWorkload = {
    promptTokens: 16,
    outputTokens: 8,
    contextTokens: 32,
    concurrentSequences: 1,
    maxStages: 8,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0.5,
    batchWindowMs: 0,
    p95: true,
  };
  return { model, topology, workload };
}

function cellNode(id: string): ComputeNodeProfile {
  return {
    id,
    region: "autonomy-cell",
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

function probedLink(from: string, to: string): DirectedLinkProfile {
  const now = Date.now();
  return {
    from,
    to,
    oneWayLatencyMs: 0.05,
    jitterP95Ms: 0,
    bandwidthMbps: 100_000,
    lossRate: 0,
    availability: 1,
    evidence: {
      source: "runtime-probe",
      measuredAt: now - 1_000,
      validUntil: now + 60_000,
      successfulSamples: 8,
      failedSamples: 0,
    },
  };
}
