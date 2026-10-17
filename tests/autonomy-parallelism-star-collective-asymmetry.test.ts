import { describe, expect, it } from "vitest";
import { compareParallelismArchitectures } from "../src/distribution/parallelism.js";
import type {
  ComputeNodeProfile,
  DirectedLinkProfile,
  DistributedModelProfile,
  DistributionPlan,
  DistributionTopology,
  DistributionWorkload,
} from "../src/distribution/types.js";

/**
 * Regresión: la estimación `tensor-star` sumaba las dos piernas de cada peer
 * (entrada + salida) y tomaba el máximo entre peers (`max(a_i + b_i)`). Un
 * all-reduce en estrella reduce todos los peers en la raíz y sólo entonces
 * difunde el resultado: la raíz espera primero al enlace de entrada más lento y
 * después al de salida más lento, que pueden pertenecer a peers distintos.
 *
 * Con una topología asimétrica `max(a_i + b_i)` es siempre menor o igual que
 * `max(a_i) + max(b_i)`, de modo que el modelo reportaba un `tensor-star` más
 * rápido de lo que ninguna topología física puede ejecutar. El arreglo conserva
 * las estrategias y su significado: los enlaces simétricos dan exactamente el
 * mismo resultado y sólo se corrigen las topologías asimétricas.
 */
describe("paralelismo: colectivo estrella con enlaces asimétricos", () => {
  it("cobra la entrada más lenta y la salida más lenta por separado", () => {
    // La raíz `a` recibe despacio de `c` (0.25 ms) y envía despacio a `b`
    // (0.25 ms), pero ninguna pierna reúne ambas. El mejor coste físico por
    // colectivo es `max(entrada) + max(salida)` = 0.5 ms. Con 3 capas, 2
    // colectivos por capa, 1 ms de cómputo por capa y endpoint 0.2 ms:
    // TPOT = 3 * (1 + 2 * 0.5) + 0.2 = 6.2 ms. La versión defectuosa daba
    // 5.0 ms (`max(a_i + b_i)` = 0.3).
    const { model, topology, workload, plan } = scenario({
      ab: 0.25,
      ba: 0.05,
      ac: 0.05,
      ca: 0.25,
      bc: 0.25,
      cb: 0.25,
    });
    const estimates = compareParallelismArchitectures(model, topology, workload, plan);

    expect(estimates.map((entry) => entry.architecture)).toEqual([
      "single-device",
      "contiguous-pipeline",
      "tensor-ring",
      "tensor-star",
    ]);
    const star = estimate(estimates, "tensor-star");
    expect(star.feasible).toBe(true);
    expect(star.tpotMs).toBeCloseTo(6.2, 6);
    expect(star.tpotMs).toBeGreaterThan(5.0);
  });

  it("no cambia el resultado con enlaces simétricos", () => {
    // Todos los enlaces a 0.1 ms: `max(entrada) + max(salida)` = 0.2 ms por
    // colectivo, idéntico a `max(a_i + b_i)`. TPOT = 3 * (1 + 2 * 0.2) + 0.2
    // = 4.4 ms. El ring conserva su cálculo: paso de 0.1 ms y 2 * (3 - 1)
    // pasos dan 0.4 ms por colectivo, TPOT = 3 * 1.8 + 0.2 = 5.6 ms.
    const { model, topology, workload, plan } = scenario({
      ab: 0.1,
      ba: 0.1,
      ac: 0.1,
      ca: 0.1,
      bc: 0.1,
      cb: 0.1,
    });
    const estimates = compareParallelismArchitectures(model, topology, workload, plan);

    expect(estimate(estimates, "tensor-star").tpotMs).toBeCloseTo(4.4, 6);
    expect(estimate(estimates, "tensor-ring").tpotMs).toBeCloseTo(5.6, 6);
  });
});

function estimate(
  estimates: ReturnType<typeof compareParallelismArchitectures>,
  architecture: "single-device" | "contiguous-pipeline" | "tensor-ring" | "tensor-star",
) {
  const found = estimates.find((entry) => entry.architecture === architecture);
  if (!found) throw new Error(`missing_estimate:${architecture}`);
  return found;
}

function scenario(latencies: {
  ab: number;
  ba: number;
  ac: number;
  ca: number;
  bc: number;
  cb: number;
}): {
  model: DistributedModelProfile;
  topology: DistributionTopology;
  workload: DistributionWorkload;
  plan: DistributionPlan;
} {
  const model: DistributedModelProfile = {
    id: "autonomy-parallelism-star-collective-asymmetry",
    layers: Array.from({ length: 3 }, (_, index) => ({
      index,
      weightBytes: 1_024,
      activationElements: 64,
      kvBytesPerToken: 0,
      decodeMsAtUnit: 3,
      prefillMsPerTokenAtUnit: 0,
    })),
    embeddingBytes: 1_024,
    lmHeadBytes: 1_024,
    runtimeOverheadBytesPerStage: 0,
    embeddingDecodeMsAtUnit: 0.1,
    lmHeadDecodeMsAtUnit: 0.1,
    embeddingPrefillMsPerTokenAtUnit: 0,
    lmHeadPrefillMsPerTokenAtUnit: 0,
  };
  const topology: DistributionTopology = {
    nodes: ["a", "b", "c"].map(cellNode),
    links: [
      probedLink("a", "b", latencies.ab),
      probedLink("b", "a", latencies.ba),
      probedLink("a", "c", latencies.ac),
      probedLink("c", "a", latencies.ca),
      probedLink("b", "c", latencies.bc),
      probedLink("c", "b", latencies.cb),
    ],
  };
  const workload: DistributionWorkload = {
    promptTokens: 3,
    outputTokens: 1,
    contextTokens: 1,
    concurrentSequences: 1,
    maxStages: 3,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0,
    batchWindowMs: 0,
    p95: false,
  };
  const plan: DistributionPlan = {
    algorithm: "autonomy-parallelism-star-collective-asymmetry",
    codec: "fp16",
    microBatchSize: 1,
    prefillChunkTokens: 3,
    stages: [
      { nodeId: "a", layerStart: 0, layerEnd: 1 },
      { nodeId: "b", layerStart: 1, layerEnd: 2 },
      { nodeId: "c", layerStart: 2, layerEnd: 3 },
    ],
  };
  return { model, topology, workload, plan };
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

function probedLink(from: string, to: string, oneWayLatencyMs: number): DirectedLinkProfile {
  const now = Date.now();
  return {
    from,
    to,
    oneWayLatencyMs,
    jitterP95Ms: 0,
    // Ancho de banda infinito para medir sólo la latencia; `rawTransferMs`
    // interpreta la serialización como cero.
    bandwidthMbps: Number.POSITIVE_INFINITY,
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
