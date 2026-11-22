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
  const range = `${process.layerStart}:${process.layerEnd}:${process.totalLayers}`;
  const destination = resolve(
    preparation.cacheDirectory,
    "native-gguf-stages",
    createHash("sha256")
      .update("mycellios-native-gguf-stage-cache/1\0")
      .update(`${source.tensorManifestId}\0${range}\0${model.canonicalSource}\0${model.canonicalRevision ?? ""}`)
      .digest("hex"),
  );
  const args = [
    "-u", "-m", "distributed_runtime.native_gguf_remote", "fetch-stage",
    "--url", source.artifactUrl,
    "--manifest-url", source.tensorManifestUrl,
    "--manifest-id", source.tensorManifestId,
    "--destination", destination,
    "--layer-start", String(process.layerStart),
    "--layer-end", String(process.layerEnd),
    "--model-source", model.canonicalSource,
    ...(model.canonicalRevision === null ? [] : ["--model-revision", model.canonicalRevision]),
    "--reuse-verified",
  ];
  const result = parseRemoteStageResult(await preparation.run(args));
  if (
    result.layerStart !== process.layerStart
    || result.layerEnd !== process.layerEnd
    || result.totalLayers !== process.totalLayers
  ) {
    throw new Error("native_gguf_source_returned_wrong_range");
  }
  if (result.modelIdentity !== model.artifactIdentity) {
    throw new Error("native_gguf_source_returned_wrong_model_identity");
  }
  if (resolve(result.destination) !== destination) {
    throw new Error("native_gguf_source_returned_wrong_destination");
  }
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
