import type {
  RuntimePipelineManifestV2,
  RuntimeVirtualStageManifest,
} from "./runtime-manifest.js";
import { isRecord } from "./python-value-guards.js";

/**
 * A pinned quantized GGUF from which every node builds its own stage package.
 *
 * The coordinator seals this source, and the engine that runs the stages,
 * into the launch description. It never names a host path: each node fetches
 * the tensor manifest, checks it against `tensorManifestId`, downloads only
 * its stage's tensors by HTTPS range and verifies each one before building
 * the package (`python -m distributed_runtime.native_gguf_remote fetch-stage`).
 * The node's stage preparer then adds the package and, for llama.cpp, its own
 * pinned build directory to the local command.
 */
export const NATIVE_GGUF_SOURCE_SCHEMA = "mycellios-native-gguf-source/1";

export type NativeGgufExecutor = "torch" | "llama-cpp";

export interface PythonNativeGgufSourceConfiguration {
  schema: typeof NATIVE_GGUF_SOURCE_SCHEMA;
  artifactUrl: string;
  artifactSha256: string;
  artifactSizeBytes: number;
  tensorManifestUrl: string;
  tensorManifestId: string;
  executor: NativeGgufExecutor;
}

/** Host-local flags only a node's preparer may add, never the coordinator. */
export const LLAMA_CPP_HOST_FLAGS = [
  "--llama-cpp-build-dir",
  "--llama-cpp-build",
  "--llama-cpp-view-cache",
  "--llama-cpp-gpu-layers",
] as const;

const LLAMA_CPP_BUILD = /^llama\.cpp-b\d{1,8}-[a-z0-9]+(?:-[a-z0-9]+){0,4}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_URL_LENGTH = 2_048;

interface SourceContext {
  runtimeModel: {
    snapshotIdentity?: string;
    artifactIdentity?: string;
    canonicalSource?: string;
    canonicalRevision?: string | null;
  };
  /** True when any per-stage native, RAM-backed MoE or paged-KV binding exists. */
  hasStageBindings: boolean;
  hasStagePackageIdentities: boolean;
}

export function normalizeNativeGgufSource(
  manifest: RuntimePipelineManifestV2,
  value: unknown,
  context: SourceContext,
): PythonNativeGgufSourceConfiguration | null {
  if (value === undefined) return null;
  if (!isRecord(value)) throw new Error("python_native_gguf_source_is_invalid");
  const keys = Object.keys(value).sort();
  const expected = [
    "artifactSha256",
    "artifactSizeBytes",
    "artifactUrl",
    "executor",
    "schema",
    "tensorManifestId",
    "tensorManifestUrl",
  ];
  if (keys.join(",") !== expected.join(",")) {
    throw new Error("python_native_gguf_source_keys_are_invalid");
  }
  if (value.schema !== NATIVE_GGUF_SOURCE_SCHEMA) {
    throw new Error("python_native_gguf_source_schema_is_invalid");
  }
  const source: PythonNativeGgufSourceConfiguration = {
    schema: NATIVE_GGUF_SOURCE_SCHEMA,
    artifactUrl: httpsUrl(value.artifactUrl, "artifact_url"),
    artifactSha256: digest(value.artifactSha256, "artifact_sha256"),
    artifactSizeBytes: positiveInteger(value.artifactSizeBytes, "artifact_size_bytes"),
    tensorManifestUrl: httpsUrl(value.tensorManifestUrl, "tensor_manifest_url"),
    tensorManifestId: digest(value.tensorManifestId, "tensor_manifest_id"),
    executor: executor(value.executor),
  };
  const model = context.runtimeModel;
  if (
    model.snapshotIdentity === undefined
    || model.artifactIdentity === undefined
    || model.canonicalSource === undefined
    || model.canonicalRevision === undefined
  ) {
    throw new Error("python_native_gguf_source_requires_global_model_coordinates");
  }
  if (context.hasStageBindings || context.hasStagePackageIdentities) {
    throw new Error("python_native_gguf_source_conflicts_with_stage_bindings");
  }
  for (const plan of [manifest.plans.prefill, manifest.plans.decode]) {
    for (const stage of plan.stages) assertPlainStage(stage);
  }
  return source;
}

/** Coordinator-rendered flags; the package and host paths come from the node. */
export function nativeGgufSourceArguments(
  source: PythonNativeGgufSourceConfiguration | null | undefined,
): string[] {
  return source ? ["--native-gguf-executor", source.executor] : [];
}

/**
 * Guard for a command about to start on a node. The executor flag may appear
 * once with a known value; llama.cpp host flags only beside the llama.cpp
 * executor and a sealed native package binding.
 */
export function validateNativeGgufExecutorArguments(
  args: readonly unknown[],
  hasNativeBinding: boolean,
): void {
  const executors = flagValues(args, "--native-gguf-executor");
  if (executors.length > 1) throw new Error("native_gguf_executor_flag_is_repeated");
  const chosen = executors[0];
  if (chosen !== undefined && chosen !== "torch" && chosen !== "llama-cpp") {
    throw new Error("native_gguf_executor_is_invalid");
  }
  const hostFlags = LLAMA_CPP_HOST_FLAGS.filter((flag) => args.includes(flag));
  if (chosen !== "llama-cpp") {
    if (hostFlags.length > 0) throw new Error("llama_cpp_flags_require_llama_cpp_executor");
    return;
  }
  if (!hasNativeBinding) throw new Error("llama_cpp_executor_requires_native_gguf_package");
  for (const flag of ["--llama-cpp-build-dir", "--llama-cpp-build", "--llama-cpp-view-cache"]) {
    if (flagValues(args, flag).length !== 1) throw new Error(`llama_cpp_flag_is_missing:${flag}`);
  }
  if (!LLAMA_CPP_BUILD.test(String(flagValues(args, "--llama-cpp-build")[0]))) {
    throw new Error("llama_cpp_build_is_invalid");
  }
  const gpuLayers = flagValues(args, "--llama-cpp-gpu-layers");
  if (gpuLayers.length > 1 || (gpuLayers.length === 1 && !/^(?:0|[1-9]\d{0,3})$/.test(String(gpuLayers[0])))) {
    throw new Error("llama_cpp_gpu_layers_is_invalid");
  }
}

export function isLlamaCppBuild(value: unknown): value is string {
  return typeof value === "string" && LLAMA_CPP_BUILD.test(value);
}

function assertPlainStage(stage: RuntimeVirtualStageManifest): void {
  if (
    stage.execution !== undefined
    || stage.macroWave !== undefined
    || stage.dense !== undefined
    || stage.members.length !== 1
  ) {
    throw new Error(`python_native_gguf_source_stage_is_not_plain:${stage.stageId}`);
  }
}

function flagValues(args: readonly unknown[], flag: string): unknown[] {
  return args.flatMap((argument, index) => argument === flag ? [args[index + 1]] : []);
}

function httpsUrl(value: unknown, name: string): string {
  let url: URL;
  try {
    if (typeof value !== "string" || value.length > MAX_URL_LENGTH) throw new Error();
    url = new URL(value);
  } catch {
    throw new Error(`python_native_gguf_source_${name}_is_invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.href !== value) {
    throw new Error(`python_native_gguf_source_${name}_is_invalid`);
  }
  return value as string;
}

function digest(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`python_native_gguf_source_${name}_is_invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`python_native_gguf_source_${name}_is_invalid`);
  }
  return value as number;
}

function executor(value: unknown): NativeGgufExecutor {
  if (value !== "torch" && value !== "llama-cpp") {
    throw new Error("python_native_gguf_source_executor_is_invalid");
  }
  return value;
}
