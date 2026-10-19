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
 * Regresión: la estimación tensor-parallel fabricaba una celda
 * `feasible:true` ante un `concurrentSequences` no válido.
 *
 * `concurrentSequences` es un entero positivo por contrato, y
 * `evaluateDistributionPlan` ya falla cerrado sobre él
 * (`concurrent_sequences_must_be_a_positive_integer`). Pero
 * `tensorParallelEstimate` calcula su propio caudal sin pasar por esa puerta:
 * `tpotMs = decodeMs * concurrentSequences`, de modo que con
 * `concurrentSequences = 0` devolvía `tpotMs = 0`,
 * `tokensPerSecondPerSequence = Infinity` y `aggregateTokensPerSecond = NaN`
 * con `feasible:true`, y con un valor fraccionario (p.ej. 1.5) producía una
 * estimación finita que ningún workload físico puede ejecutar.
 *
 * El arreglo añade la misma comprobación de entero positivo que usa el modelo
 * de coste y devuelve la estimación tensorial infactible con el mismo motivo.
 * Las estrategias (`tensor-ring`, `tensor-star`) y su significado no cambian:
 * un workload válido sigue admitiéndose exactamente igual que antes.
 */
describe("paralelismo: concurrentSequences no válido en la celda tensorial", () => {
  it.each([0, 1.5])(
    "rechaza la celda tensorial con concurrentSequences = %s",
    (concurrentSequences) => {
      const scenario = buildScenario(concurrentSequences);
      const estimates = compareParallelismArchitectures(
        scenario.model,
        scenario.topology,
        scenario.workload,
        scenario.plan,
      );

      // El pipeline ya fallaba cerrado; la novedad es que tensor-ring y
      // tensor-star dejan de colarse con métricas NaN/inventadas.
      const contiguous = estimate(estimates, "contiguous-pipeline");
      expect(contiguous.feasible).toBe(false);
      expect(contiguous.reason).toBe(
        "concurrent_sequences_must_be_a_positive_integer",
      );

      for (const architecture of ["tensor-ring", "tensor-star"] as const) {
        const entry = estimate(estimates, architecture);
        expect(entry.feasible, architecture).toBe(false);
        expect(entry.reason, architecture).toBe(
          "concurrent_sequences_must_be_a_positive_integer",
        );
        expect(entry.tpotMs, architecture).toBe(Number.POSITIVE_INFINITY);
        expect(entry.aggregateTokensPerSecond, architecture).toBe(0);
        expect(Number.isNaN(entry.aggregateTokensPerSecond), architecture).toBe(
          false,
        );
        expect(
          Number.isFinite(entry.tokensPerSecondPerSequence),
          architecture,
        ).toBe(true);
      }
    },
  );

  it("mantiene intacta la admisión con concurrentSequences válido", () => {
    const scenario = buildScenario(1);
    const estimates = compareParallelismArchitectures(
      scenario.model,
      scenario.topology,
      scenario.workload,
      scenario.plan,
    );

    for (const architecture of ["tensor-ring", "tensor-star"] as const) {
      const entry = estimate(estimates, architecture);
      expect(entry.feasible, architecture).toBe(true);
      expect(entry.reason, architecture).toBeNull();
      expect(entry.tpotMs, architecture).toBeGreaterThan(0);
      expect(entry.aggregateTokensPerSecond, architecture).toBeGreaterThan(0);
      expect(Number.isFinite(entry.tpotMs), architecture).toBe(true);
    }
  });
});

function estimate(
  estimates: ReturnType<typeof compareParallelismArchitectures>,
  architecture: "contiguous-pipeline" | "tensor-ring" | "tensor-star",
) {
  const found = estimates.find((entry) => entry.architecture === architecture);
  if (!found) throw new Error(`missing_estimate:${architecture}`);
  return found;
}

function buildScenario(concurrentSequences: number): {
  model: DistributedModelProfile;
  topology: DistributionTopology;
  workload: DistributionWorkload;
  plan: DistributionPlan;
} {
  const model: DistributedModelProfile = {
    id: "autonomy-parallelism-concurrency",
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
    concurrentSequences,
    maxStages: 3,
    maxQualityLoss: 0.01,
    minRouteAvailability: 0,
    batchWindowMs: 0,
    p95: false,
  };
  const plan: DistributionPlan = {
    algorithm: "autonomy-parallelism-concurrency",
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
