import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  engineRuntimeChallengeSchema,
  engineRuntimeChallengeRequestSchema,
  type EngineRuntimeChallenge,
} from "../src/contracts/evidence-challenge.js";
import { engineRuntimeExactnessSchema } from "../src/contracts/engine-runtime-profile.js";
import { probeLlamaCppEngineRuntimeProfile } from "../src/worker/llama-cpp-engine-probe.js";

const BUILD = "llama.cpp-b12613-win-vulkan-x64";
const CACHE = resolve(tmpdir(), "mycellios-probe-cache");

function request(backend: "vulkan" | "cpu" = "vulkan") {
  return {
    probeKind: "llama-cpp-gguf-v1" as const,
    gguf: {
      artifactUrl: "https://huggingface.co/org/model-GGUF/resolve/0123/model.gguf",
      artifactSha256: "8".repeat(64),
      artifactSizeBytes: 1_000_000,
      tensorManifestUrl: "https://models.example/model.tensors.json",
      tensorManifestId: "9".repeat(64),
      modelSource: "hf://org/model",
    },
    descriptorDigest: `sha256:${"a".repeat(64)}`,
    certificationId: `sha256:${"b".repeat(64)}`,
    artifactManifestDigest: `sha256:${"9".repeat(64)}`,
    modelId: "smollm2",
    modelRevision: "1".repeat(40),
    backend,
    runtimeAbi: BUILD,
    quantization: "Q4_K_M",
    contextTokens: 4_096,
    expectedLayerStart: 0,
    expectedLayerEnd: 12,
    expectedKvBytesPerToken: 2 * 32 * 64 * 2 * 12,
    expectedLayerWeightBytes: 500_000_000,
    referenceDecodeMsPerToken: 10,
    referencePrefillMsPerToken: 1,
    hiddenSize: 2_048,
    attentionHeads: 32,
    kvHeads: 32,
    headDim: 64,
    requiredRoles: ["head" as const],
    minimumSamples: 7,
  };
}

function challenge(backend: "vulkan" | "cpu" = "vulkan"): EngineRuntimeChallenge {
  const now = Date.now();
  return engineRuntimeChallengeSchema.parse({
    schema: "mycellios-evidence-challenge/1", kind: "engine-runtime", challengeId: "challenge-1",
    nonce: "n".repeat(43), sessionId: "session-1", workerId: "worker-1", nodeId: "node-1",
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(),
    ...request(backend),
  });
}

function runner(options: { gpuOffload?: boolean; backend?: string; build?: string } = {}) {
  return vi.fn(async (_executable: string, args: readonly string[]) => {
    const flag = (name: string) => args[args.indexOf(name) + 1]!;
    if (args.includes("distributed_runtime.llama_cpp_install")) {
      const build = options.build ?? BUILD;
      return { code: 0, stderr: "", stdout: `${JSON.stringify({ build, buildDirectory: join(flag("--cache"), build), gpuOffload: options.gpuOffload ?? true })}\n` };
    }
    if (args.includes("fetch-stage")) {
      return { code: 0, stderr: "", stdout: JSON.stringify({
        destination: flag("--destination"), packageId: "3".repeat(64), packageIdentity: `sha256:${"3".repeat(64)}`,
        modelIdentity: `sha256:${"4".repeat(64)}`, layerStart: 0, layerEnd: 12, totalLayers: 24, weightsSizeBytes: 1,
      }) };
    }
    return { code: 0, stderr: "", stdout: `load_backend: Vulkan\n${JSON.stringify({
      schema: "mycellios-llama-cpp-stage-profile/1",
      measurement: {
        measuredAt: new Date().toISOString(), samples: 7, confidenceHalfWidthPct: 3,
        capacity: { contextTokens: Number(flag("--llama-cpp-context-tokens")), maxLayerCount: 12,
          kvBytesPerToken: 2 * 32 * 64 * 2 * 12, maxKvTokens: 4_096, usableMemoryBytes: 600_000_000 },
        costs: { decodeMsPerTokenP50: 13, decodeMsPerTokenP95: 15, prefillMsPerTokenP50: 1.5, prefillMsPerTokenP95: 2,
          verifyMsPerTokenP50: 4, verifyMsPerTokenP95: 5, decodeScale: 1.3, prefillScale: 1.5 },
        features: { fastKernel: true, graphMode: "unavailable", roles: ["head"] },
      },
      exactness: { runtimeAbi: BUILD, backend: options.backend ?? "vulkan", batchClasses: [[1], [2, 4, 8]],
        exactMicroBatchSizes: [1], exactSpeculation: false, gpuDevices: ["AMD Radeon(TM) 890M Graphics"] },
    })}\n` };
  });
}

const options = (commandRunner: ReturnType<typeof runner>) => ({
  pythonExecutable: "python", pythonPath: ["C:\\mycellios\\python"], cacheDirectory: CACHE, commandRunner,
});

describe("llama.cpp engine qualification on a node", () => {
  it("installs the build, builds the challenged range and seals the measured exactness", async () => {
    const commands = runner();
    const measurement = await probeLlamaCppEngineRuntimeProfile(challenge(), options(commands));
    expect(measurement.exactness).toEqual({ runtimeAbi: BUILD, backend: "vulkan", exactMicroBatchSizes: [1], exactSpeculation: false });
    const calls = commands.mock.calls.map((call) => call[1]);
    expect(calls[0]).toEqual(["-u", "-m", "distributed_runtime.llama_cpp_install", "--cache", join(CACHE, "llama-cpp-builds")]);
    expect(calls[1]).toEqual(expect.arrayContaining(["fetch-stage", "--manifest-id", "9".repeat(64),
      "--model-source", "hf://org/model", "--model-revision", "1".repeat(40), "--reuse-verified"]));
    const profile = calls[2]!;
    expect(profile.slice(0, 2)).toEqual(["-m", "distributed_runtime.llama_cpp_profile"]);
    expect(profile[profile.indexOf("--llama-cpp-gpu-layers") + 1]).toBe("13");
    expect(profile[profile.indexOf("--native-gguf-package-id") + 1]).toBe("3".repeat(64));
    expect(profile[profile.indexOf("--llama-cpp-build-dir") + 1]).toBe(join(CACHE, "llama-cpp-builds", BUILD));
  });

  it("keeps a CPU challenge on the CPU", async () => {
    const commands = runner({ backend: "cpu" });
    const measurement = await probeLlamaCppEngineRuntimeProfile(challenge("cpu"), options(commands));
    expect(measurement.exactness?.backend).toBe("cpu");
    const profile = commands.mock.calls[2]![1];
    expect(profile[profile.indexOf("--llama-cpp-gpu-layers") + 1]).toBe("0");
  });

  it("fails a Vulkan challenge that would not or did not run on a GPU", async () => {
    await expect(probeLlamaCppEngineRuntimeProfile(challenge(), options(runner({ gpuOffload: false }))))
      .rejects.toThrow("engine_runtime_probe_backend_is_unavailable");
    // ggml found no Vulkan device, so the stage ran on the CPU.
    await expect(probeLlamaCppEngineRuntimeProfile(challenge(), options(runner({ backend: "cpu" }))))
      .rejects.toThrow("engine_runtime_probe_output_does_not_match_challenge");
    await expect(probeLlamaCppEngineRuntimeProfile(challenge(), options(runner({ build: "llama.cpp-b1-win-cpu-x64" }))))
      .rejects.toThrow("engine_runtime_probe_runtime_abi_mismatch");
  });
});

describe("llama.cpp challenge and exactness contracts", () => {
  it("requires the GGUF source exactly for llama.cpp challenges on cpu or vulkan", () => {
    expect(engineRuntimeChallengeRequestSchema.safeParse(request()).success).toBe(true);
    const { gguf: _gguf, ...withoutSource } = request();
    expect(engineRuntimeChallengeRequestSchema.safeParse(withoutSource).success).toBe(false);
    expect(engineRuntimeChallengeRequestSchema.safeParse({ ...request(), backend: "cuda" }).success).toBe(false);
    expect(engineRuntimeChallengeRequestSchema.safeParse({ ...request(), gguf: { ...request().gguf, tensorManifestUrl: "http://x.example/m.json" } }).success).toBe(false);
  });

  it("accepts only exact sizes that start at one and agree with exact speculation", () => {
    const exactness = { runtimeAbi: BUILD, backend: "cpu", exactMicroBatchSizes: [1, 2, 3, 4, 5, 6, 7], exactSpeculation: true };
    expect(engineRuntimeExactnessSchema.safeParse(exactness).success).toBe(true);
    for (const broken of [
      { ...exactness, exactSpeculation: false },
      { ...exactness, exactMicroBatchSizes: [2, 3] },
      { ...exactness, exactMicroBatchSizes: [1, 3, 2] },
      { ...exactness, backend: "cuda" },
    ]) expect(engineRuntimeExactnessSchema.safeParse(broken).success).toBe(false);
  });
});
