import { resolve } from "node:path";
import type { EngineRuntimeChallenge } from "../contracts/evidence-challenge.js";
import {
  engineRuntimeExactnessSchema,
  engineRuntimeMeasurementSchema,
  type EngineRuntimeMeasurement,
} from "../contracts/engine-runtime-profile.js";
import {
  runRuntimeProfileCommand,
  type RuntimeProfileCommandRunner,
} from "../performance/runtime-profile-probe.js";
import { fetchNativeGgufStage, installLlamaCppRuntime } from "./native-gguf-stage-preparer.js";

export interface LlamaCppEngineProbeOptions {
  pythonExecutable: string;
  pythonPath: readonly string[];
  /** The node cache shared with route preparation (builds, packages, views). */
  cacheDirectory: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Bounded by the challenge expiry the worker agent enforces. */
  timeoutMs?: number;
  threads?: number;
  warmupSamples?: number;
  commandRunner?: RuntimeProfileCommandRunner;
}

const MAXIMUM_OUTPUT_BYTES = 256 * 1024;

/**
 * Answer a llama-cpp-gguf-v1 challenge with the same pieces a route uses:
 * the pinned build (installed on demand), the challenged range's package
 * built from the pinned GGUF, and the stage runner. The profile reports the
 * backend ggml really ran on and the exact micro-batch sizes the self-test
 * found, so a node without a working Vulkan driver fails a Vulkan challenge
 * instead of publishing a CPU measurement under a GPU name.
 */
export async function probeLlamaCppEngineRuntimeProfile(
  challenge: EngineRuntimeChallenge,
  options: LlamaCppEngineProbeOptions,
): Promise<EngineRuntimeMeasurement> {
  if (challenge.probeKind !== "llama-cpp-gguf-v1" || !challenge.gguf) {
    throw new Error("engine_runtime_probe_kind_is_unsupported");
  }
  const executable = options.pythonExecutable.trim();
  if (!executable || options.pythonPath.some((entry) => !entry.trim())) {
    throw new Error("engine_runtime_probe_runtime_is_invalid");
  }
  const separator = process.platform === "win32" ? ";" : ":";
  const runner = options.commandRunner ?? runRuntimeProfileCommand;
  const run = async (args: string[]): Promise<string> => {
    const result = await runner(executable, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      timeoutMs: options.timeoutMs ?? 600_000,
      env: {
        ...process.env,
        ...options.env,
        PYTHONPATH: options.pythonPath.join(separator),
        TOKENIZERS_PARALLELISM: "false",
      },
    });
    if (result.code !== 0) {
      throw new Error(`engine_runtime_probe_failed:${result.code}:${boundedText(result.stderr)}`);
    }
    if (Buffer.byteLength(result.stdout, "utf8") > MAXIMUM_OUTPUT_BYTES) {
      throw new Error("engine_runtime_probe_output_is_too_large");
    }
    return finalLine(result.stdout);
  };

  const build = await installLlamaCppRuntime(run, options.cacheDirectory);
  if (build.build !== challenge.runtimeAbi) throw new Error("engine_runtime_probe_runtime_abi_mismatch");
  if (challenge.backend === "vulkan" && !build.gpuOffload) {
    throw new Error("engine_runtime_probe_backend_is_unavailable");
  }
  const stage = await fetchNativeGgufStage(run, {
    source: challenge.gguf,
    cacheDirectory: options.cacheDirectory,
    layerStart: challenge.expectedLayerStart,
    layerEnd: challenge.expectedLayerEnd,
    modelSource: challenge.gguf.modelSource,
    modelRevision: challenge.modelRevision,
  });
  const layers = challenge.expectedLayerEnd - challenge.expectedLayerStart;
  const output = JSON.parse(await run([
    "-m", "distributed_runtime.llama_cpp_profile",
    "--native-gguf-package", stage.destination,
    "--native-gguf-package-id", stage.packageId,
    "--native-gguf-executor", "llama-cpp",
    "--llama-cpp-build-dir", build.buildDirectory,
    "--llama-cpp-build", build.build,
    "--llama-cpp-view-cache", resolve(options.cacheDirectory, "llama-cpp-views"),
    "--llama-cpp-gpu-layers", String(challenge.backend === "vulkan" ? layers + 1 : 0),
    "--llama-cpp-context-tokens", String(challenge.contextTokens),
    "--reference-decode-ms-per-token", String(challenge.referenceDecodeMsPerToken),
    "--reference-prefill-ms-per-token", String(challenge.referencePrefillMsPerToken),
    "--warmup-samples", String(options.warmupSamples ?? 2),
    "--samples", String(challenge.minimumSamples),
    "--threads", String(options.threads ?? 4),
  ])) as { schema?: unknown; measurement?: unknown; exactness?: Record<string, unknown> };
  if (output.schema !== "mycellios-llama-cpp-stage-profile/1" || !output.exactness) {
    throw new Error("engine_runtime_probe_output_is_invalid");
  }
  const exactness = engineRuntimeExactnessSchema.parse({
    runtimeAbi: output.exactness.runtimeAbi,
    backend: output.exactness.backend,
    exactMicroBatchSizes: output.exactness.exactMicroBatchSizes,
    exactSpeculation: output.exactness.exactSpeculation,
  });
  const measurement = engineRuntimeMeasurementSchema.parse({
    ...(output.measurement as Record<string, unknown>),
    exactness,
  });
  if (
    exactness.backend !== challenge.backend
    || exactness.runtimeAbi !== challenge.runtimeAbi
    || measurement.samples < challenge.minimumSamples
    || measurement.capacity.contextTokens !== challenge.contextTokens
    || measurement.capacity.kvBytesPerToken !== challenge.expectedKvBytesPerToken
    || measurement.capacity.maxLayerCount < layers
  ) {
    throw new Error("engine_runtime_probe_output_does_not_match_challenge");
  }
  return measurement;
}

function finalLine(serialized: string): string {
  const final = serialized.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!final) throw new Error("engine_runtime_probe_output_is_not_json");
  return final;
}

function boundedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(-1_024) || "no_stderr";
}
