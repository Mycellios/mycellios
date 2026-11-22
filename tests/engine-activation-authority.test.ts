import { describe, expect, it } from "vitest";
import {
  ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
  buildEngineRuntimeActivationPlans,
  recordEngineRuntimeActivationPlans,
  engineActivationAuthoritySchema,
} from "../src/coordinator/engine-activation-authority.js";
import {
  ENGINE_CERTIFICATION_SCHEMA,
  ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
  sealEngineCertification,
} from "../src/contracts/engine-family.js";
import { sha256CanonicalEvidence } from "../src/core/json.js";
import type { AutoDistributionRunResult } from "../src/distribution/auto-distribute.js";
import type { StoredWorker } from "../src/storage/store.js";

const digest = (value: string) => `sha256:${value.repeat(64)}` as const;
const revision = "1".repeat(40);
const artifact = digest("a");

function authority() {
  const descriptor = {
    schema: ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
    familyId: "qwen3-dense", version: "1.0.0", implementationDigest: digest("1"),
    tensorAbi: "mycellios-tensor-v1",
    model: { modelId: "Qwen/Qwen3-Test", revision, manifestDigest: artifact,
      nativeAdapterId: "transformers-qwen3-v1",
      implementationContract: "mycellios-selective-qwen3-v1" },
    ownership: { embeddings: "head" as const, outputHead: "tail" as const,
      tokenizer: "root" as const, sharedTensorIds: [] },
    operations: ["prepare", "load", "prefill", "verify", "decode", "reset",
      "checkpoint", "rollback", "health", "receipt-observe", "unload"] as const,
    targets: [{ platform: "linux" as const, arch: "x64" as const,
      backend: "cuda" as const, runtimeAbi: "cuda-12", quantizations: ["bf16"],
      context: { minTokens: 1, maxTokens: 8_192 }, graphMode: "optional" as const,
      minDriver: null }],
    boundaryConstraints: [],
  };
  return {
    schema: ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
    descriptor,
    certification: sealEngineCertification({
      schema: ENGINE_CERTIFICATION_SCHEMA,
      descriptorDigest: sha256CanonicalEvidence(descriptor), sourceId: digest("3"),
      artifactManifestDigest: artifact, status: "certified" as const,
      validFrom: "2026-08-01T00:00:00.000Z", expiresAt: "2026-09-01T00:00:00.000Z",
      targets: descriptor.targets, hardwareClasses: ["nvidia-test-gpu"],
      parity: [{ kind: "tokens" as const, evidenceDigest: digest("4"), evidenceClass: "lan" as const }],
    }),
    probe: { kind: "qwen3-dense-v1" as const, quantization: "bf16",
      attentionHeads: 8, kvHeads: 2, headDim: 64,
      referenceDecodeMsPerToken: 8, referencePrefillMsPerToken: 0.4,
      minimumSamples: 7 },
  };
}

function result(): AutoDistributionRunResult {
  const layers = Array.from({ length: 4 }, (_, index) => ({
    index, weightBytes: 1_024, activationElements: 512, kvBytesPerToken: 512,
    decodeMsAtUnit: 1, prefillMsPerTokenAtUnit: 1,
  }));
  return {
    profile: { schema: "gdlp-model-profile/1",
      source: { model: "Qwen/Qwen3-Test", revision, snapshotCommit: revision,
        snapshotIdentityUint64Hex: "0000000000000001", artifactIdentity: artifact,
        canonicalSource: "Qwen/Qwen3-Test", canonicalRevision: revision, format: "safetensors" },
      inspection: { architecture: "Qwen3ForCausalLM", calibrationRequired: false },
      compatibility: { selectiveSafetensors: true, requiresAdapter: true,
        adapterId: "transformers-qwen3-v1", reasons: [] },
      model: { id: "qwen-public", layers, embeddingBytes: 1, lmHeadBytes: 1,
        runtimeOverheadBytesPerStage: 1, embeddingDecodeMsAtUnit: 1,
        lmHeadDecodeMsAtUnit: 1, embeddingPrefillMsPerTokenAtUnit: 1,
        lmHeadPrefillMsPerTokenAtUnit: 1 } },
    request: { workload: { contextTokens: 4_096 } },
    manifest: { hiddenSize: 512, plans: { decode: { stages: [
      { index: 0, layerStart: 0, layerEnd: 2, members: [{ nodeId: "node-a" }] },
      { index: 1, layerStart: 2, layerEnd: 4, members: [{ nodeId: "node-b" }] },
    ] } } }, canaryText: "OK", canaryMetrics: { completionTokens: 1, ttftMs: 1,
      tpotMs: 1, pipelineMs: 2, measuredTokensPerSecond: 1 },
  } as unknown as AutoDistributionRunResult;
}

function worker(id: string, nodeId: string, stageIndex: number): StoredWorker {
  const layerStart = stageIndex * 2;
  return { id, status: "online", reliability: 1, jobsCompleted: 0, lastSeenAt: Date.now(),
    identityKind: "device", identityId: id,
    capabilities: { region: "test", agentVersion: "1", gpus: [{ id: "gpu-0",
      vendor: "NVIDIA", model: "Test GPU", physicalVramMb: 16_384,
      offeredVramMb: 16_384, freeOfferedVramMb: 16_384 }],
      limits: { maxConcurrency: 1, pauseWhenForeground: false },
      network: { coordinatorRttMs: 1, uplinkMbps: 1_000, downlinkMbps: 1_000 },
      distributedExecutor: { protocol: "gdlp-worker-tunnel/2", nodeId,
        stageHost: "127.0.0.1", stagePort: 9000 + stageIndex, runtime: "python-safetensors",
        physicalIdentity: { schema: "gdlp-worker-physical-identity/1", provider: "generic",
          providerMachineFingerprintSha256: digest("5"), hostFingerprintSha256: digest("6"),
          gpuFingerprintsSha256: [digest("7")], attestedAt: "2026-08-10T12:00:00Z" },
        performanceEvidence: { profile: { backend: "cuda" } } as never },
      deployments: [{ deploymentId: `deployment-${id}`, model: "qwen-public",
        modelDigest: artifact, activationId: "activation-1", mode: "pipeline",
        adapter: "mycellios-pipeline", peakVramMb: 1, contextLimit: 4_096,
        maxConcurrency: 1, freeSlots: 1, tokensPerSecond: 1,
        throughputSource: "measured", ttftMs: 1, verificationState: "verified",
        dataLocality: "local", stage: { index: stageIndex, total: 2,
          layerStart, layerEnd: layerStart + 2 }, execution: { deviceType: "gpu",
          backend: "cuda", deviceName: "Test GPU", precision: "bf16", fallback: false,
          stages: [{ nodeId, stageIndex, layerStart, layerEnd: layerStart + 2,
            deviceType: "gpu", backend: "cuda", deviceName: "Test GPU",
            precision: "bf16", fallback: false }] } }] } };
}

describe("engine activation authority", () => {
  it("pins a GGUF artifact only when the certification binds its tensor manifest", () => {
    const manifestId = "9".repeat(64);
    const certified = authority();
    certified.descriptor.model.manifestDigest = `sha256:${manifestId}` as typeof artifact;
    const resealed = {
      ...certified,
      certification: sealEngineCertification({
        ...certified.certification,
        descriptorDigest: sha256CanonicalEvidence(certified.descriptor),
        artifactManifestDigest: `sha256:${manifestId}`,
      }),
    };
    const pin = {
      format: "gguf" as const,
      url: "https://huggingface.co/org/model-GGUF/resolve/0123/model-q4_k_m.gguf",
      sha256: "8".repeat(64),
      sizeBytes: 1_055_609_536,
      tensorManifestUrl: "https://github.com/Mycellios/mycellios/releases/download/gguf-manifest/manifest.json",
      tensorManifestId: manifestId,
    };

    expect(engineActivationAuthoritySchema.parse({ ...resealed, artifact: pin }).artifact).toEqual(pin);
    expect(() => engineActivationAuthoritySchema.parse({
      ...resealed, artifact: { ...pin, tensorManifestId: "7".repeat(64) },
    })).toThrow("engine_activation_authority_artifact_is_not_certified");
    expect(() => engineActivationAuthoritySchema.parse({
      ...resealed, artifact: { ...pin, url: "http://huggingface.co/model.gguf" },
    })).toThrow("gguf_artifact_url_must_use_https");
    expect(() => engineActivationAuthoritySchema.parse({
      ...resealed, artifact: { ...pin, tensorManifestUrl: "http://example.com/manifest.json" },
    })).toThrow("gguf_tensor_manifest_url_must_use_https");
    // Authorities without an artifact keep working unchanged.
    expect(engineActivationAuthoritySchema.parse(authority()).artifact).toBeUndefined();
  });

  it("accepts only canonical draft tokenizer and vocabulary fingerprints", () => {
    const current = authority();
    expect(engineActivationAuthoritySchema.parse({
      ...current,
      draftCompatibility: {
        tokenizerDigest: digest("8"),
        vocabularyDigest: digest("9"),
      },
    }).draftCompatibility).toEqual({
      tokenizerDigest: digest("8"),
      vocabularyDigest: digest("9"),
    });
    expect(() => engineActivationAuthoritySchema.parse({
      ...current,
      draftCompatibility: {
        tokenizerDigest: "tokenizer-latest",
        vocabularyDigest: digest("9"),
      },
    })).toThrow();
  });

  it("derives exact per-stage physical challenges from certified activation evidence", () => {
    const plans = buildEngineRuntimeActivationPlans(authority(), "qwen-public", "activation-1", "reservation-1",
      result(), [worker("worker-a", "node-a", 0), worker("worker-b", "node-b", 1)],
      Date.parse("2026-08-10T12:00:00Z"));
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.request.requiredRoles)).toEqual([["head"], ["tail"]]);
    expect(plans.every((plan) => plan.request.expectedKvBytesPerToken === 1_024)).toBe(true);
  });

  it("fails closed without exact verified stage evidence", () => {
    const missing = worker("worker-a", "node-a", 0);
    delete missing.capabilities.distributedExecutor!.performanceEvidence;
    expect(() => buildEngineRuntimeActivationPlans(authority(), "qwen-public", "activation-1", "reservation-1",
      result(), [missing, worker("worker-b", "node-b", 1)],
      Date.parse("2026-08-10T12:00:00Z")))
      .toThrow("engine_activation_stage_evidence_is_missing:node-a:0");
  });

  describe("recording plans for a committed activation", () => {
    const now = Date.parse("2026-08-10T12:00:00Z");
    const activated = () => ({ ...result(), launch: { launchId: "launch-7" } }) as unknown as AutoDistributionRunResult;
    const workers = () => [worker("worker-a", "node-a", 0), worker("worker-b", "node-b", 1)];
    function store() {
      const calls: Array<[string, ...unknown[]]> = [];
      return {
        calls,
        async replaceEngineRuntimeActivationPlans(modelId: string, activationId: string, values: readonly unknown[]) {
          calls.push(["replace", modelId, activationId, values]);
          return values;
        },
        async removeEngineRuntimeActivationPlans(modelId: string) {
          calls.push(["remove", modelId]);
          return 0;
        },
      };
    }

    it("stores one challenge per stage member, bound to the route and launch", async () => {
      const target = store();
      const outcome = await recordEngineRuntimeActivationPlans({
        authority: authority(), modelId: "qwen-public", routeReservationId: "reservation-1",
        result: activated(), workers: workers(), store: target, now,
      });

      expect(outcome).toEqual({ status: "recorded", plans: 2 });
      expect(target.calls).toHaveLength(1);
      const [kind, modelId, activationId, values] = target.calls[0]!;
      expect([kind, modelId, activationId]).toEqual(["replace", "qwen-public", "launch-7"]);
      const plans = values as Array<{ workerId: string; routeReservationId: string; activationId: string }>;
      expect(plans.map((plan) => plan.workerId)).toEqual(["worker-a", "worker-b"]);
      expect(plans.every((plan) => plan.routeReservationId === "reservation-1" && plan.activationId === "launch-7"))
        .toBe(true);
    });

    it("clears stale plans instead of failing a serving route whose evidence does not bind", async () => {
      const target = store();
      const uncertified = workers();
      uncertified[0]!.capabilities.gpus[0]!.model = "Other GPU";
      const outcome = await recordEngineRuntimeActivationPlans({
        authority: authority(), modelId: "qwen-public", routeReservationId: "reservation-1",
        result: activated(), workers: uncertified, store: target, now,
      });

      expect(outcome).toEqual({ status: "skipped", reason: "engine_activation_hardware_is_not_certified:node-a" });
      expect(target.calls).toEqual([["remove", "qwen-public"]]);
    });

    it("clears plans when the activation has no committed route reservation", async () => {
      const target = store();
      const outcome = await recordEngineRuntimeActivationPlans({
        authority: authority(), modelId: "qwen-public", routeReservationId: null,
        result: activated(), workers: workers(), store: target, now,
      });

      expect(outcome).toEqual({ status: "skipped", reason: "engine_activation_route_reservation_is_missing" });
      expect(target.calls).toEqual([["remove", "qwen-public"]]);
    });

    it("reports an expired certification without storing plans", async () => {
      const target = store();
      const outcome = await recordEngineRuntimeActivationPlans({
        authority: authority(), modelId: "qwen-public", routeReservationId: "reservation-1",
        result: activated(), workers: workers(), store: target, now: Date.parse("2026-10-01T00:00:00Z"),
      });

      expect(outcome).toEqual({ status: "skipped", reason: "engine_activation_authority_certification_is_not_current" });
      expect(target.calls).toEqual([["remove", "qwen-public"]]);
    });
  });
});
