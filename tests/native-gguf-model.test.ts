import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DynamicModelActivationManager } from "../src/coordinator/model-activation-manager.js";
import type { StoredRequestedModel } from "../src/storage/store.js";
import {
  ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
  engineActivationAuthoritySchema,
} from "../src/coordinator/engine-activation-authority.js";
import { createNativeGgufModelResolver } from "../src/coordinator/native-gguf-model.js";
import {
  ggufTensorManifestIdentity,
  ggufTensorManifestSchema,
  type GgufTensorManifest,
} from "../src/contracts/gguf-tensor-manifest.js";
import {
  ENGINE_CERTIFICATION_SCHEMA,
  ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
  sealEngineCertification,
} from "../src/contracts/engine-family.js";
import { sha256CanonicalEvidence } from "../src/core/json.js";
import {
  compileAutoDistribution,
  parseAutoDistributionConfig,
  type AutoDistributionConfig,
} from "../src/distribution/auto-distribute.js";
import { compileGgufModelProfile, ggufNativeModelIdentity } from "../src/distribution/gguf-model-profile.js";

const MIB = 1024 * 1024;
const MODEL = "HuggingFaceTB/SmolLM2-1.7B-Instruct";
const REVISION = "3".repeat(40);

function manifest(options: { tied?: boolean; layers?: number; configText?: string } = {}): GgufTensorManifest {
  const layers = options.layers ?? 8;
  const configText = options.configText ?? `${JSON.stringify({
    model_type: "llama", num_hidden_layers: layers, hidden_size: 2048,
    num_attention_heads: 32, num_key_value_heads: 8, tie_word_embeddings: options.tied ?? true,
  })}\n`;
  const tensors: Array<{ name: string; sizeBytes: number }> = [{ name: "token_embd.weight", sizeBytes: 80 * MIB }];
  for (let index = 0; index < layers; index += 1) {
    tensors.push({ name: `blk.${index}.attn_q.weight`, sizeBytes: 10 * MIB + index });
    tensors.push({ name: `blk.${index}.ffn_down.weight`, sizeBytes: 20 * MIB });
  }
  tensors.push({ name: "output_norm.weight", sizeBytes: 8_192 });
  if (options.tied === false) tensors.push({ name: "output.weight", sizeBytes: 90 * MIB });
  let offset = 4_096;
  const content = {
    schema: "gdlp-gguf-tensor-manifest/1" as const,
    source: { sha256: "a".repeat(64), sizeBytes: 0 },
    header: { sizeBytes: 4_096, sha256: "b".repeat(64) },
    architecture: "llama",
    configText,
    tensors: tensors.map((tensor) => {
      const entry = { ...tensor, offset, sha256: "c".repeat(64) };
      offset += tensor.sizeBytes;
      return entry;
    }),
  };
  content.source.sizeBytes = offset;
  return ggufTensorManifestSchema.parse({ ...content, manifestId: ggufTensorManifestIdentity(content) });
}

function authority(pinned: GgufTensorManifest, executor: "torch" | "llama-cpp" = "llama-cpp") {
  const manifestDigest = `sha256:${pinned.manifestId}`;
  const descriptor = {
    schema: ENGINE_FAMILY_DESCRIPTOR_SCHEMA,
    familyId: "llama-cpp-gguf", version: "1.0.0", implementationDigest: `sha256:${"1".repeat(64)}`,
    tensorAbi: "mycellios-tensor-v1",
    model: { modelId: MODEL, revision: REVISION, manifestDigest,
      nativeAdapterId: "llama-cpp-gguf-v1", implementationContract: "mycellios-native-gguf-v1" },
    ownership: { embeddings: "head" as const, outputHead: "tail" as const, tokenizer: "root" as const, sharedTensorIds: [] },
    operations: ["prepare", "load", "prefill", "verify", "decode", "reset",
      "checkpoint", "rollback", "health", "receipt-observe", "unload"] as const,
    targets: [{ platform: "win32" as const, arch: "x64" as const, backend: "cpu" as const,
      runtimeAbi: "llama.cpp-b12613", quantizations: ["Q4_K_M"],
      context: { minTokens: 1, maxTokens: 4_096 }, graphMode: "optional" as const, minDriver: null }],
    boundaryConstraints: [],
  };
  return engineActivationAuthoritySchema.parse({
    schema: ENGINE_ACTIVATION_AUTHORITY_SCHEMA,
    descriptor,
    certification: sealEngineCertification({
      schema: ENGINE_CERTIFICATION_SCHEMA,
      descriptorDigest: sha256CanonicalEvidence(descriptor), sourceId: `sha256:${"3".repeat(64)}`,
      artifactManifestDigest: manifestDigest, status: "certified",
      validFrom: "2026-11-01T00:00:00.000Z", expiresAt: "2026-12-31T00:00:00.000Z",
      targets: descriptor.targets, hardwareClasses: ["amd-test-gpu"],
      parity: [{ kind: "tokens", evidenceDigest: `sha256:${"4".repeat(64)}`, evidenceClass: "lan" }],
    }),
    artifact: {
      format: "gguf",
      url: "https://huggingface.co/org/model-GGUF/resolve/0123/model-q4_k_m.gguf",
      sha256: pinned.source.sha256,
      sizeBytes: pinned.source.sizeBytes,
      tensorManifestUrl: "https://models.example/model-q4_k_m.tensors.json",
      tensorManifestId: pinned.manifestId,
      executor,
    },
    probe: { kind: "qwen3-dense-v1", quantization: "Q4_K_M", attentionHeads: 32, kvHeads: 8, headDim: 64,
      referenceDecodeMsPerToken: 8, referencePrefillMsPerToken: 0.4, minimumSamples: 7 },
  });
}

describe("GGUF model profiles from a tensor manifest", () => {
  it("computes the same model identity as the Python stage packages", () => {
    const pinned = manifest({ configText: '{"model_type": "llama", "name": "café"}\n' });
    // python: native_gguf._native_model_identity("a" * 64, sha256(configText))
    expect(ggufNativeModelIdentity(pinned))
      .toBe("sha256:3dde0f804c2b70b1fb4a7e956ede7e0899b1d973af05a250137e1b19942af78f");
  });

  it("budgets each block's quantized bytes and a tied head on both ends", () => {
    const profile = compileGgufModelProfile(manifest(), { modelId: MODEL, canonicalSource: `hf://${MODEL}`, canonicalRevision: REVISION });
    expect(profile.source.format).toBe("gguf");
    expect(profile.source.revision).toBeNull();
    expect(profile.source.artifactIdentity).toBe(ggufNativeModelIdentity(manifest()));
    expect(profile.source.snapshotIdentityUint64Hex).toBe(profile.source.artifactIdentity.slice(7, 23));
    expect(profile.model.layers).toHaveLength(8);
    expect(profile.model.layers[3]).toMatchObject({ weightBytes: 30 * MIB + 3, kvBytesPerToken: 2 * 8 * 64 * 2, activationElements: 2048 });
    expect(profile.model.tiedEmbeddingAndHead).toBe(true);
    expect(profile.model.lmHeadBytes).toBe(80 * MIB + 8_192);
    const untied = compileGgufModelProfile(manifest({ tied: false }), { modelId: MODEL, canonicalSource: `hf://${MODEL}`, canonicalRevision: REVISION });
    expect(untied.model.tiedEmbeddingAndHead).toBe(false);
    expect(untied.model.lmHeadBytes).toBe(90 * MIB + 8_192);
  });

  it("rejects a manifest whose blocks do not cover the configured layers", () => {
    const short = manifest({ layers: 4, configText: `${JSON.stringify({
      num_hidden_layers: 5, hidden_size: 2048, num_attention_heads: 32 })}` });
    expect(() => compileGgufModelProfile(short, { modelId: MODEL, canonicalSource: `hf://${MODEL}`, canonicalRevision: REVISION }))
      .toThrow("gguf_profile_block_has_no_tensors:4");
  });

  it("plans a route whose every stage builds its package from the pinned GGUF", () => {
    const pinned = manifest();
    const profile = compileGgufModelProfile(pinned, { modelId: MODEL, canonicalSource: `hf://${MODEL}`, canonicalRevision: REVISION });
    const source = {
      schema: "mycellios-native-gguf-source/1" as const,
      artifactUrl: "https://huggingface.co/org/model-GGUF/resolve/0123/model-q4_k_m.gguf",
      artifactSha256: pinned.source.sha256,
      artifactSizeBytes: pinned.source.sizeBytes,
      tensorManifestUrl: "https://models.example/model-q4_k_m.tensors.json",
      tensorManifestId: pinned.manifestId,
      executor: "llama-cpp" as const,
    };
    const config = configFixture();
    config.runtime = { ...config.runtime, nativeGgufSource: source };
    const { launch } = compileAutoDistribution(config, profile);
    expect(launch.configuration.nativeGgufSource).toEqual(source);
    expect(launch.runtimeModel).toMatchObject({ source: MODEL, revision: null,
      artifactIdentity: profile.source.artifactIdentity, canonicalSource: `hf://${MODEL}`, canonicalRevision: REVISION });
    expect(launch.launchOrder).toHaveLength(2);
    for (const process of launch.launchOrder) {
      const index = process.command.args.indexOf("--native-gguf-executor");
      expect(process.command.args[index + 1]).toBe("llama-cpp");
    }
    const { nativeGgufSource: _source, ...runtime } = config.runtime;
    expect(() => compileAutoDistribution({ ...config, runtime }, profile)).toThrow("model_is_not_automatically_distributable");
  });
});

describe("certified GGUF resolution in the coordinator", () => {
  const model = { id: "smollm2-1.7b", source: MODEL, revision: null };

  it("fetches the pinned manifest once and returns its profile and source", async () => {
    const pinned = manifest();
    const fetcher = vi.fn(async () => JSON.stringify(pinned));
    const resolve = createNativeGgufModelResolver(authority(pinned), fetcher);
    const first = await resolve(model);
    await resolve(model);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://models.example/model-q4_k_m.tensors.json", 64 * MIB);
    expect(first?.source).toMatchObject({ tensorManifestId: pinned.manifestId, executor: "llama-cpp" });
    expect(first?.profile.source.artifactIdentity).toBe(ggufNativeModelIdentity(pinned));
    expect(await resolve({ ...model, source: "Qwen/Qwen3-0.6B" })).toBeNull();
  });

  it("refuses a manifest other than the pinned one and retries after a failure", async () => {
    const pinned = manifest();
    const other = manifest({ tied: false });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(other))
      .mockRejectedValueOnce(new Error("http_503"))
      .mockResolvedValueOnce(JSON.stringify(pinned));
    const resolve = createNativeGgufModelResolver(authority(pinned), fetcher);
    await expect(resolve(model)).rejects.toThrow("gguf_tensor_manifest_is_not_the_pinned_one");
    await expect(resolve(model)).rejects.toThrow("gguf_tensor_manifest_unavailable:http_503");
    expect((await resolve(model))?.source.tensorManifestId).toBe(pinned.manifestId);
  });

  it("activates a certified model from its GGUF without profiling the checkpoint", async () => {
    const pinned = manifest();
    const resolver = createNativeGgufModelResolver(authority(pinned), async () => JSON.stringify(pinned));
    const root = mkdtempSync(join(tmpdir(), "mycellios-gguf-activation-"));
    try {
      const config = parseAutoDistributionConfig({ ...configFixture(), artifactsDirectory: root });
      const measuredCandidateEvidence = vi.fn(async () => null);
      const planned: unknown[] = [];
      const manager = new DynamicModelActivationManager({
        snapshot: () => ({ capacityNodes: [{ id: "node-a", availableVramMiB: 2_048 }, { id: "node-b", availableVramMiB: 2_048 }], config }),
        resolveManagedAgent: () => undefined,
        resolveNativeGgufModel: resolver,
        measuredCandidateEvidence,
        cwd: root,
        onPlanPrepared: (_modelId, stages) => {
          planned.push(stages);
          throw new Error("stop_after_plan");
        },
      });
      await manager.initialize();
      await expect(manager.activate({
        id: "smollm2", source: MODEL, revision: null, contextTokens: 128, minimumNodes: 2, autoActivate: true,
        profile: null, profileError: null, activationRequestedAt: Date.now(), activationError: null,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as StoredRequestedModel)).rejects.toThrow("stop_after_plan");
      expect(planned).toHaveLength(1);
      expect(measuredCandidateEvidence).not.toHaveBeenCalled();
      const launch = JSON.parse(readFileSync(join(root, "smollm2", "python-launch.json"), "utf8"));
      expect(launch.configuration.nativeGgufSource.tensorManifestId).toBe(pinned.manifestId);
      expect(launch.runtimeModel.artifactIdentity).toBe(ggufNativeModelIdentity(pinned));
      await manager.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function configFixture(): AutoDistributionConfig {
  const node = (id: string, port: number) => ({
    id, region: "test", endpoint: { host: id, port }, memoryMiB: 2_048, reserveMiB: 256,
    decodeScale: 1, prefillScale: 1, codecScale: 1, powerWatts: 20, availability: 0.99,
    agent: { kind: "managed" as const },
  });
  return {
    schema: "gdlp-auto-distribute/1",
    model: { source: MODEL, revision: null, publicName: "smollm2" },
    nodes: [node("node-a", 9_851), node("node-b", 9_852)],
    links: [],
    distribution: { minimumStages: 2, maximumStages: 2, allowLossyActivation: false },
    workload: { promptTokens: 8, outputTokens: 8, contextTokens: 128, concurrentSequences: 1,
      minRouteAvailability: 0.9, batchWindowMs: 0, p95: true },
    runtime: {
      pythonExecutable: "python", pythonPath: "python", hfHome: "runtime/hf-cache",
      apiEndpoint: { host: "0.0.0.0", port: 9_860 }, apiAdvertiseHost: "node-a",
      returnEndpoint: { host: "node-a", port: 9_861 }, returnBindHost: "0.0.0.0",
      threadsPerStage: 1, connectTimeoutSeconds: 60, readinessTimeoutMs: 120_000, maxOutputTokens: 128,
    },
    canary: { prompt: "OK", maxTokens: 8, timeoutMs: 120_000 },
  } as AutoDistributionConfig;
}
