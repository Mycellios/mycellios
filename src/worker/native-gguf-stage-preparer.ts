import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { PythonNativeGgufSourceConfiguration } from "../distribution/native-gguf-source.js";
import { isLlamaCppBuild } from "../distribution/native-gguf-source.js";
import type {
  PythonLaunchProcess,
  PythonNativeGgufStageConfiguration,
  PythonPipelineLaunchDescription,
} from "../distribution/python-launcher.js";

/**
 * The node's own pinned llama.cpp build. It comes from this node's
 * configuration or runtime component cache, never from a launch description.
 */
export interface LlamaCppNodeRuntime {
  buildDirectory: string;
  build: string;
  /** Offload every block of the stage to the GPU (Vulkan, CUDA builds). */
  gpuOffload: boolean;
}

export interface RemoteNativeGgufStageResult {
  destination: string;
  packageId: string;
  modelIdentity: string;
  layerStart: number;
  layerEnd: number;
  totalLayers: number;
  weightsSizeBytes: number;
}

export interface RemoteNativeGgufPreparation {
  source: PythonNativeGgufSourceConfiguration;
  cacheDirectory: string;
  llamaCpp?: LlamaCppNodeRuntime;
  run: (args: string[]) => Promise<string>;
  verify: (binding: PythonNativeGgufStageConfiguration) => Promise<void>;
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Install (or reuse) the pinned llama.cpp build for this platform under the
 * node's cache. The installer verifies the official archive and every library
 * against their pinned hashes before the directory is ever used.
 */
export async function installLlamaCppRuntime(
  run: (args: string[]) => Promise<string>,
  cacheDirectory: string,
): Promise<LlamaCppNodeRuntime> {
  const cache = resolve(cacheDirectory, "llama-cpp-builds");
  let value: unknown;
  try {
    value = JSON.parse(await run(["-u", "-m", "distributed_runtime.llama_cpp_install", "--cache", cache]));
  } catch (error) {
    throw new Error(`native_gguf_llama_cpp_runtime_unavailable:${error instanceof Error ? error.message : "unknown"}`);
  }
  const result = value as Record<string, unknown> | null;
  if (
    !result
    || !isLlamaCppBuild(result.build)
    || typeof result.buildDirectory !== "string"
    || resolve(result.buildDirectory) !== resolve(cache, result.build)
    || typeof result.gpuOffload !== "boolean"
  ) {
    throw new Error("native_gguf_llama_cpp_installer_returned_invalid_result");
  }
  return { buildDirectory: resolve(result.buildDirectory), build: result.build, gpuOffload: result.gpuOffload };
}

/**
 * Build (or reuse) this node's package for one stage from the pinned GGUF and
 * return the local command that runs it. The package is fetched by tensor,
 * each tensor checked against the pinned manifest, and the result checked
 * again in process before the command is returned.
 */
export async function prepareRemoteNativeGgufProcess(
  description: PythonPipelineLaunchDescription,
  process: PythonLaunchProcess,
  preparation: RemoteNativeGgufPreparation,
): Promise<{ process: PythonLaunchProcess; result: RemoteNativeGgufStageResult }> {
  if (process.kind === "cell-member") throw new Error("native_gguf_source_cell_member_is_invalid");
  const { source, llamaCpp } = preparation;
  if (source.executor === "llama-cpp" && (llamaCpp === undefined || !isLlamaCppBuild(llamaCpp.build))) {
    throw new Error("native_gguf_llama_cpp_runtime_unavailable");
  }
  const model = description.runtimeModel;
  if (
    model.artifactIdentity === undefined
    || model.canonicalSource === undefined
    || model.canonicalRevision === undefined
  ) {
    throw new Error("native_gguf_source_requires_global_model_coordinates");
  }
  const result = await fetchNativeGgufStage(preparation.run, {
    source,
    cacheDirectory: preparation.cacheDirectory,
    layerStart: process.layerStart,
    layerEnd: process.layerEnd,
    modelSource: model.canonicalSource,
    modelRevision: model.canonicalRevision,
  });
  if (result.totalLayers !== process.totalLayers) {
    throw new Error("native_gguf_source_returned_wrong_range");
  }
  if (result.modelIdentity !== model.artifactIdentity) {
    throw new Error("native_gguf_source_returned_wrong_model_identity");
  }
  const destination = result.destination;
  const binding: PythonNativeGgufStageConfiguration = {
    packagePath: destination,
    packageId: result.packageId,
    modelIdentity: result.modelIdentity,
    modelSource: model.canonicalSource,
    modelRevision: model.canonicalRevision,
    layerStart: process.layerStart,
    layerEnd: process.layerEnd,
    totalLayers: process.totalLayers,
  };
  await preparation.verify(binding);

  const command = [...process.command.args];
  if (LOCAL_FLAGS.some((flag) => command.includes(flag))) {
    throw new Error("native_gguf_source_command_already_names_local_paths");
  }
  command.push(
    "--stage-package-identity", `sha256:${result.packageId}`,
    "--native-gguf-package", destination,
    "--native-gguf-package-id", result.packageId,
  );
  if (source.executor === "llama-cpp") {
    command.push(
      "--llama-cpp-build-dir", llamaCpp!.buildDirectory,
      "--llama-cpp-build", llamaCpp!.build,
      "--llama-cpp-view-cache", resolve(preparation.cacheDirectory, "llama-cpp-views"),
      // A non-tail view carries one extra block; offloading beyond the
      // block count is clamped by llama.cpp.
      "--llama-cpp-gpu-layers", String(llamaCpp!.gpuOffload ? process.layerEnd - process.layerStart + 1 : 0),
    );
  }
  return {
    process: { ...process, nativeGguf: binding, command: { ...process.command, args: command } } as PythonLaunchProcess,
    result,
  };
}

/**
 * Build or reuse one range's package from the pinned GGUF in the node cache.
 * Routes and engine probes share the cache, so a probe's package is the one
 * the route later runs.
 */
export async function fetchNativeGgufStage(
  run: (args: string[]) => Promise<string>,
  input: {
    source: Pick<PythonNativeGgufSourceConfiguration, "artifactUrl" | "tensorManifestUrl" | "tensorManifestId">;
    cacheDirectory: string;
    layerStart: number;
    layerEnd: number;
    modelSource: string;
    modelRevision: string | null;
  },
): Promise<RemoteNativeGgufStageResult> {
  const { source } = input;
  const destination = resolve(
    input.cacheDirectory,
    "native-gguf-stages",
    createHash("sha256")
      .update("mycellios-native-gguf-stage-cache/2\0")
      .update(`${source.tensorManifestId}\0${input.layerStart}:${input.layerEnd}\0${input.modelSource}\0${input.modelRevision ?? ""}`)
      .digest("hex"),
  );
  const result = parseRemoteStageResult(await run([
    "-u", "-m", "distributed_runtime.native_gguf_remote", "fetch-stage",
    "--url", source.artifactUrl,
    "--manifest-url", source.tensorManifestUrl,
    "--manifest-id", source.tensorManifestId,
    "--destination", destination,
    "--layer-start", String(input.layerStart),
    "--layer-end", String(input.layerEnd),
    "--model-source", input.modelSource,
    ...(input.modelRevision === null ? [] : ["--model-revision", input.modelRevision]),
    "--reuse-verified",
  ]));
  if (result.layerStart !== input.layerStart || result.layerEnd !== input.layerEnd) {
    throw new Error("native_gguf_source_returned_wrong_range");
  }
  if (resolve(result.destination) !== destination) {
    throw new Error("native_gguf_source_returned_wrong_destination");
  }
  return { ...result, destination };
}

const LOCAL_FLAGS = [
  "--stage-package-identity",
  "--native-gguf-package",
  "--native-gguf-package-id",
  "--llama-cpp-build-dir",
  "--llama-cpp-build",
  "--llama-cpp-view-cache",
  "--llama-cpp-gpu-layers",
];

function parseRemoteStageResult(stdout: string): RemoteNativeGgufStageResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("native_gguf_source_returned_invalid_json");
  }
  const candidate = value as Record<string, unknown> | null;
  if (
    !candidate
    || typeof candidate !== "object"
    || typeof candidate.destination !== "string"
    || typeof candidate.packageId !== "string"
    || !SHA256.test(candidate.packageId)
    || candidate.packageIdentity !== `sha256:${candidate.packageId}`
    || typeof candidate.modelIdentity !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(candidate.modelIdentity)
  ) {
    throw new Error("native_gguf_source_returned_invalid_identity");
  }
  for (const key of ["layerStart", "layerEnd", "totalLayers", "weightsSizeBytes"] as const) {
    if (!Number.isSafeInteger(candidate[key]) || Number(candidate[key]) < 0) {
      throw new Error(`native_gguf_source_returned_invalid_${key}`);
    }
  }
  return candidate as unknown as RemoteNativeGgufStageResult;
}
