import { describe, expect, it } from "vitest";
import { engineRuntimeChallengeRequestSchema } from "../src/contracts/evidence-challenge.js";

// Qwen3-4B: hidden 2560, 32 query heads of 128 (attention width 4096), 8 KV heads.
const qwen3FourB = {
  descriptorDigest: `sha256:${"a".repeat(64)}`,
  certificationId: `sha256:${"b".repeat(64)}`,
  artifactManifestDigest: `sha256:${"c".repeat(64)}`,
  modelId: "Qwen/Qwen3-4B",
  modelRevision: "1".repeat(40),
  runtimeAbi: "llama.cpp-b12613",
  quantization: "Q4_K_M",
  contextTokens: 4_096,
  expectedLayerStart: 0,
  expectedLayerEnd: 18,
  expectedKvBytesPerToken: 2 * 8 * 128 * 2 * 18,
  expectedLayerWeightBytes: 1_400_000_000,
  referenceDecodeMsPerToken: 80,
  referencePrefillMsPerToken: 4,
  hiddenSize: 2_560,
  attentionHeads: 32,
  kvHeads: 8,
  headDim: 128,
  requiredRoles: ["head"],
  minimumSamples: 7,
} as const;

const gguf = {
  artifactUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/0123/Qwen3-4B-Q4_K_M.gguf",
  artifactSha256: "d".repeat(64),
  artifactSizeBytes: 2_497_280_256,
  tensorManifestUrl: "https://models.example/qwen3-4b-q4_k_m.tensors.json",
  tensorManifestId: "e".repeat(64),
  modelSource: "hf://Qwen/Qwen3-4B",
};

describe("engine runtime challenge shape", () => {
  it("accepts a llama.cpp probe whose attention width differs from the hidden size", () => {
    const parsed = engineRuntimeChallengeRequestSchema.safeParse({
      ...qwen3FourB, probeKind: "llama-cpp-gguf-v1", backend: "vulkan", gguf,
    });
    expect(parsed.success).toBe(true);
  });

  it("still requires a square attention projection for the synthetic qwen3-dense probe", () => {
    const parsed = engineRuntimeChallengeRequestSchema.safeParse({
      ...qwen3FourB, probeKind: "qwen3-dense-v1", backend: "cuda",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.message))
      .toContain("engine_runtime_challenge_qwen3_shape_is_invalid");
  });

  it("keeps rejecting a llama.cpp probe whose KV budget does not match its heads", () => {
    const parsed = engineRuntimeChallengeRequestSchema.safeParse({
      ...qwen3FourB, probeKind: "llama-cpp-gguf-v1", backend: "vulkan", gguf,
      expectedKvBytesPerToken: qwen3FourB.expectedKvBytesPerToken + 2,
    });
    expect(parsed.success).toBe(false);
  });
});
