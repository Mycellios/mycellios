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
 * Regresión: la estimación `tensor-ring` reportaba los bytes de red como
 * `2*(N-1)*mensaje/N` (bytes por nodo), mientras que `tensor-star` reportaba
 * `2*(N-1)*mensaje` (bytes totales de la red). Un all-reduce mueve la misma
 * cantidad total de bytes por el cable con independencia de la topología del
 * colectivo: el anillo divide el mensaje en `N` trozos a lo largo de
 * `2*(N-1)` pasos y la estrella agrupa y después difunde el mensaje completo,
 * de modo que ambos suman `2*(N-1)*mensaje`. Sólo cambia el tamaño de cada paso.
 *
 * Antes, para el mismo celda y mensaje, el anillo quedaba infracalculado por un
 * factor `N` respecto de la estrella en `networkBytesPerOutputToken` (en el
 * escenario de 3 nodos: 1024 frente a 3072), lo que sesgaba la comparación de
 * arquitecturas en favor del anillo sin razón física. El arreglo reporta el
 * total para ambas; las estrategias y su significado no cambian (ring y star
 * siguen siendo admitidas igual, sólo se corrige la métrica de red).
 */
describe("paralelismo: bytes de red del anillo frente a la estrella", () => {
  it("reporta el total de bytes por la red, no por nodo, para el anillo", () => {
    const { model, topology, workload, plan } = scenario();
    const estimates = compareParallelismArchitectures(model, topology, workload, plan);

    expect(estimates.map((entry) => entry.architecture)).toEqual([
      "single-device",
      "contiguous-pipeline",
      "tensor-ring",
      "tensor-star",
    ]);

    const ring = estimate(estimates, "tensor-ring");
    const star = estimate(estimates, "tensor-star");

    // 3 capas, 2 colectivos por capa, mensaje de activación FP16 de 128 bytes:
    // 3 * 2 * (2*(3-1)*128) = 3072 bytes por token de salida, para ambas.
    expect(ring.feasible).toBe(true);
    expect(ring.networkBytesPerOutputToken).toBe(3_072);
    expect(star.networkBytesPerOutputToken).toBe(3_072);

    // El anillo ya no queda por debajo de la estrella en bytes de red.
    expect(ring.networkBytesPerOutputToken).toBe(
      star.networkBytesPerOutputToken,
    );
  });

  it("sólo corrige la métrica de red: no altera latencia ni factibilidad", () => {
    const { model, topology, workload, plan } = scenario();
    const estimates = compareParallelismArchitectures(model, topology, workload, plan);

    const ring = estimate(estimates, "tensor-ring");
    const star = estimate(estimates, "tensor-star");

    // Las estrategias conservan su significado y su coste temporal.
    expect(ring.feasible).toBe(true);
    expect(star.feasible).toBe(true);
    expect(Number.isFinite(ring.tpotMs)).toBe(true);
    expect(Number.isFinite(star.tpotMs)).toBe(true);
    // El ring es más lento que la estrella en esta celda simétrica por sus 4
    // pasos por colectivo; esto ya se ejercita en la regresión de la estrella.
    expect(ring.tpotMs).toBeGreaterThan(star.tpotMs);
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

function scenario(): {
  model: DistributedModelProfile;
  topology: DistributionTopology;
  workload: DistributionWorkload;
  plan: DistributionPlan;
} {
  const model: DistributedModelProfile = {
    id: "autonomy-parallelism-ring-network-bytes",
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
    links: [0.1, 0.1, 0.1, 0.1, 0.1, 0.1].map((latency, index) =>
      probedLink(["a", "b", "a", "c", "b", "c"][index]!, ["b", "a", "c", "a", "c", "b"][index]!, latency),
    ),
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
    algorithm: "autonomy-parallelism-ring-network-bytes",
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
