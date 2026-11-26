import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalEvidenceJson } from "../src/core/json.js";
import {
  compileAutoDistribution,
  type AutoDistributionConfig,
  type CompiledModelProfile,
} from "../src/distribution/auto-distribute.js";
import {
  compilePythonLaunchDescription,
  validatePythonLaunchDescription,
  type PythonLaunchProcess,
  type PythonPipelineLaunchDescription,
} from "../src/distribution/python-launcher.js";
import { validateLaunchAgentRpcStartRequest } from "../src/distribution/launch-agent-rpc.js";
import { validateNativeGgufExecutorArguments } from "../src/distribution/native-gguf-source.js";
import type { DistributedModelProfile } from "../src/distribution/types.js";
import { prepareNodeStageArtifacts } from "../src/worker/stage-artifact-preparer.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("worker-local stage artifact preparation", () => {
  it("prepares one package per local range and rewrites only trusted local commands", async () => {
    const description = fixture();
    const before = structuredClone(description);
    const local = description.launchOrder.filter(
      (process) => process.anchor.memberId === "node-a",
    );
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      const layerStart = Number(flagValue(args, "--layer-start"));
      const layerEnd = Number(flagValue(args, "--layer-end"));
      const process = local.find(
        (candidate) => candidate.layerStart === layerStart && candidate.layerEnd === layerEnd,
      )!;
      const packageId = "a".repeat(64);
      const modelIdentity = description.runtimeModel.artifactIdentity!;
      return JSON.stringify({
        destination: flagDestination(args),
        package_id: packageId,
        artifact_identity: `sha256:${packageId}`,
        model_identity: modelIdentity,
        layer_start: layerStart,
        layer_end: layerEnd,
        total_layers: process.totalLayers,
        weights_size_bytes: 1_024,
      });
    });
    const cacheRunner = vi.fn(async (_executable: string, args: readonly string[]) => {
      const packageId = flagValue(args, "--expected-package-id");
      const cacheRoot = flagValue(args, "--cache-root");
      return JSON.stringify({
        cache_root: cacheRoot,
        package_directory: join(cacheRoot, "packages", packageId),
        package_id: packageId,
        artifact_identity: `sha256:${packageId}`,
        manifest_sha256: "c".repeat(64),
        downloaded_bytes: 2_048,
        resumed_bytes: 0,
        materialized: true,
        objects: [],
      });
    });
    const progress: Array<Record<string, unknown>> = [];
    const prepared = await prepareNodeStageArtifacts(description, {
      nodeId: "node-a",
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      compilerRunner: runner,
      artifactCacheRunner: cacheRunner,
      onProgress: (event) => progress.push(event),
    });

    expect(runner).toHaveBeenCalledTimes(new Set(
      local.map((process) => `${process.layerStart}:${process.layerEnd}:${process.totalLayers}`),
    ).size);
    expect(cacheRunner).toHaveBeenCalledTimes(runner.mock.calls.length);
    expect(progress.filter((event) => event.state === "ready")).toEqual(
      expect.arrayContaining([expect.objectContaining({
        downloadedBytes: 2_048,
        resumedBytes: 0,
        materialized: true,
      })]),
    );
    expect(prepared.map((process) => process.processId)).toEqual(
      local.map((process) => process.processId),
    );
    for (const process of prepared) {
      expect(flagValue(process.command.args, "--model")).toContain("stage-cas");
      expect(flagValue(process.command.args, "--model-artifact-identity")).toBe(
        description.runtimeModel.artifactIdentity,
      );
      expect(flagValue(process.command.args, "--stage-package-identity")).toBe(
        `sha256:${"a".repeat(64)}`,
      );
      expect(process.command.args).not.toContain("--revision");
    }
    expect(description).toEqual(before);
  });

  it("fails closed when the content-addressed cache returns another package", async () => {
    const description = fixture();
    const packageId = "d".repeat(64);
    await expect(prepareNodeStageArtifacts(description, {
      nodeId: "node-a",
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      compilerRunner: async (_executable, args) => {
        const layerStart = Number(flagValue(args, "--layer-start"));
        const layerEnd = Number(flagValue(args, "--layer-end"));
        return JSON.stringify({
          destination: flagDestination(args),
          package_id: packageId,
          artifact_identity: `sha256:${packageId}`,
          model_identity: description.runtimeModel.artifactIdentity,
          layer_start: layerStart,
          layer_end: layerEnd,
          total_layers: description.totalLayers,
          weights_size_bytes: 1,
        });
      },
      artifactCacheRunner: async (_executable, args) => {
        const cacheRoot = flagValue(args, "--cache-root");
        return JSON.stringify({
          cache_root: cacheRoot,
          package_directory: join(cacheRoot, "packages", "e".repeat(64)),
          package_id: "e".repeat(64),
          artifact_identity: `sha256:${"e".repeat(64)}`,
          manifest_sha256: "f".repeat(64),
          downloaded_bytes: 0,
          resumed_bytes: 0,
          materialized: false,
          objects: [],
        });
      },
    })).rejects.toThrow("stage_artifact_cache_returned_wrong_identity");
  });

  it("fails closed when the compiler returns another physical range", async () => {
    const description = fixture();
    await expect(prepareNodeStageArtifacts(description, {
      nodeId: "node-a",
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      compilerRunner: async (_executable, args) => JSON.stringify({
        destination: flagDestination(args),
        package_id: "b".repeat(64),
        artifact_identity: `sha256:${"b".repeat(64)}`,
        model_identity: description.runtimeModel.artifactIdentity,
        layer_start: 99,
        layer_end: 100,
        total_layers: 4,
        weights_size_bytes: 1,
      }),
    })).rejects.toThrow("stage_artifact_compiler_returned_wrong_range");
  });

  it("keeps a sealed native GGUF launch byte-for-byte unchanged and never compiles it", async () => {
    const compilerRunner = vi.fn(async () => {
      throw new Error("SafeTensors compiler must not run for native GGUF");
    });

    for (const stageIndex of [0, 1]) {
      const native = nativeFixture(stageIndex);
      const original = localNativeProcess(native.description, native.nodeId);
      const before = JSON.stringify(original);
      const cacheDirectory = temporaryDirectory();
      const prepared = await prepareNodeStageArtifacts(native.description, {
        nodeId: native.nodeId,
        pythonExecutable: "python",
        cacheDirectory,
        compilerRunner,
      });

      expect(prepared).toHaveLength(1);
      expect(JSON.stringify(prepared[0])).toBe(before);
      expect(prepared[0]).toBe(original);
      expect(existsSync(join(cacheDirectory, "native-stages"))).toBe(false);
    }
    expect(compilerRunner).not.toHaveBeenCalled();
  });

  it("fails closed before verification when sealed native argv is tampered", async () => {
    const native = nativeFixture();
    const process = localNativeProcess(native.description, native.nodeId);
    const packageId = process.command.args.indexOf("--native-gguf-package-id");
    process.command.args[packageId + 1] = "f".repeat(64);
    const nativePackageVerifier = vi.fn(async () => undefined);
    const compilerRunner = vi.fn(async () => "");

    await expect(prepareNodeStageArtifacts(native.description, {
      nodeId: native.nodeId,
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      compilerRunner,
      nativePackageVerifier,
    })).rejects.toThrow("python_launch_description_mismatch");
    expect(nativePackageVerifier).not.toHaveBeenCalled();
    expect(compilerRunner).not.toHaveBeenCalled();
  });

  it("fails closed before verification when the sealed native binding is tampered", async () => {
    const native = nativeFixture();
    const process = localNativeProcess(native.description, native.nodeId);
    if (process.kind === "cell-member" || process.nativeGguf === null) {
      throw new Error("native binding is missing");
    }
    process.nativeGguf.packagePath += "-tampered";
    const nativePackageVerifier = vi.fn(async () => undefined);

    await expect(prepareNodeStageArtifacts(native.description, {
      nodeId: native.nodeId,
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      nativePackageVerifier,
    })).rejects.toThrow("python_launch_description_mismatch");
    expect(nativePackageVerifier).not.toHaveBeenCalled();
  });

  it("fails closed when bytes inside the sealed native package are tampered", async () => {
    const native = nativeFixture();
    writeFileSync(native.weightsPath, Buffer.alloc(native.weightsSize, 0x78));
    const compilerRunner = vi.fn(async () => "");

    await expect(prepareNodeStageArtifacts(native.description, {
      nodeId: native.nodeId,
      pythonExecutable: "python",
      cacheDirectory: temporaryDirectory(),
      compilerRunner,
    })).rejects.toThrow(
      "native_stage_package_file_digest_mismatch:native-stage.gguf",
    );
    expect(compilerRunner).not.toHaveBeenCalled();
  });
});

describe("planned seed blobs during stage preparation", () => {
  it("passes only the loopback seed endpoint to the stage cache, never its token", async () => {
    const description = fixture();
    const local = description.launchOrder.filter((process) => process.anchor.memberId === "node-a");
    const runner = vi.fn(async (_executable: string, args: readonly string[]) => {
      const layerStart = Number(flagValue(args, "--layer-start"));
      const layerEnd = Number(flagValue(args, "--layer-end"));
      const process = local.find((candidate) => candidate.layerStart === layerStart && candidate.layerEnd === layerEnd)!;
      return JSON.stringify({ destination: flagDestination(args), package_id: "a".repeat(64),
        artifact_identity: `sha256:${"a".repeat(64)}`, model_identity: description.runtimeModel.artifactIdentity!,
        layer_start: layerStart, layer_end: layerEnd, total_layers: process.totalLayers, weights_size_bytes: 1_024 });
    });
    const token = "s".repeat(43);
    const cacheRunner = vi.fn(async (_executable: string, args: readonly string[]) => {
      const packageId = flagValue(args, "--expected-package-id");
      const cacheRoot = flagValue(args, "--cache-root");
      return JSON.stringify({ cache_root: cacheRoot, package_directory: join(cacheRoot, "packages", packageId),
        package_id: packageId, artifact_identity: `sha256:${packageId}`, manifest_sha256: "c".repeat(64),
        downloaded_bytes: 0, resumed_bytes: 0, materialized: true, objects: [] });
    });
    await prepareNodeStageArtifacts(description, {
      nodeId: "node-a", pythonExecutable: "python", cacheDirectory: temporaryDirectory(),
      compilerRunner: runner, artifactCacheRunner: cacheRunner,
      artifactSeed: async () => ({ url: "http://127.0.0.1:41000", token }),
    });
    expect(cacheRunner).toHaveBeenCalled();
    for (const [, args] of cacheRunner.mock.calls) {
      expect(flagValue(args, "--seed-endpoint")).toBe("http://127.0.0.1:41000");
      expect(args.join(" ")).not.toContain(token);
    }
  });
});

describe("stages built by each node from a pinned GGUF", () => {
  const modelIdentity = `sha256:${"7".repeat(64)}`;
  const source = (executor: "torch" | "llama-cpp" = "llama-cpp") => ({
    schema: "mycellios-native-gguf-source/1" as const,
    artifactUrl: "https://models.example/model-Q4_K_M.gguf",
    artifactSha256: "1".repeat(64),
    artifactSizeBytes: 1_056_000_000,
    tensorManifestUrl: "https://models.example/model-Q4_K_M.tensors.json",
    tensorManifestId: "2".repeat(64),
    executor,
  });
  const sourceDescription = (executor: "torch" | "llama-cpp" = "llama-cpp", extra: Record<string, unknown> = {}) => {
    const base = fixture();
    return compilePythonLaunchDescription(base.sourceManifest, {
      ...base.configuration,
      runtimeModel: {
        source: "HuggingFaceTB/SmolLM2-1.7B-Instruct",
        revision: null,
        snapshotIdentity: BigInt(`0x${modelIdentity.slice(7, 23)}`).toString(),
        artifactIdentity: modelIdentity,
        canonicalSource: "hf://HuggingFaceTB/SmolLM2-1.7B-Instruct",
        canonicalRevision: "c".repeat(40),
      },
      nativeGgufSource: source(executor),
      ...extra,
    });
  };
  const fetchRunner = (overrides: Record<string, unknown> = {}) =>
    vi.fn(async (_executable: string, args: readonly string[]) => JSON.stringify({
      destination: flagValue(args, "--destination"),
      packageId: "3".repeat(64),
      packageIdentity: `sha256:${"3".repeat(64)}`,
      modelIdentity,
      layerStart: Number(flagValue(args, "--layer-start")),
      layerEnd: Number(flagValue(args, "--layer-end")),
      totalLayers: 8,
      weightsSizeBytes: 4_096,
      ...overrides,
    }));
  const llamaCpp = { buildDirectory: "C:\\mycellios\\llama.cpp\\b12613", build: "llama.cpp-b12613-win-vulkan-x64", gpuOffload: true };

  it("seals the source and engine into the route without naming any host path", () => {
    const description = sourceDescription();
    expect(() => validatePythonLaunchDescription(structuredClone(description))).not.toThrow();
    expect(description.launchOrder.every((process) => process.kind !== "cell-member" && process.nativeGguf === null)).toBe(true);
    for (const process of description.launchOrder) {
      expect(flagValue(process.command.args, "--native-gguf-executor")).toBe("llama-cpp");
      for (const flag of ["--native-gguf-package", "--llama-cpp-build-dir", "--llama-cpp-view-cache"]) {
        expect(process.command.args).not.toContain(flag);
      }
    }
    expect(sourceDescription("torch").route).not.toEqual(description.route);
  });

  it("rejects sources that are not pinned HTTPS artifacts or that mix stage bindings", () => {
    const base = fixture();
    const compile = (value: Record<string, unknown>, extra: Record<string, unknown> = {}) => () =>
      compilePythonLaunchDescription(base.sourceManifest, {
        ...base.configuration,
        runtimeModel: sourceDescription().runtimeModel,
        nativeGgufSource: value as never,
        ...extra,
      });
    expect(compile({ ...source(), artifactUrl: "http://models.example/model.gguf" }))
      .toThrow("python_native_gguf_source_artifact_url_is_invalid");
    expect(compile({ ...source(), tensorManifestId: "Z".repeat(64) }))
      .toThrow("python_native_gguf_source_tensor_manifest_id_is_invalid");
    expect(compile({ ...source(), executor: "ollama" })).toThrow("python_native_gguf_source_executor_is_invalid");
    expect(compile({ ...source(), buildDirectory: "C:\\llama" })).toThrow("python_native_gguf_source_keys_are_invalid");
    expect(compile(source(), { stagePackageIdentities: { "node-a": `sha256:${"4".repeat(64)}` } }))
      .toThrow("python_native_gguf_source_conflicts_with_stage_bindings");
  });

  it("builds each local range from the manifest and adds only node-owned paths", async () => {
    const description = sourceDescription();
    const runner = fetchRunner();
    const verifier = vi.fn(async () => undefined);
    const cacheDirectory = temporaryDirectory();
    const prepared = await prepareNodeStageArtifacts(description, {
      nodeId: "node-b",
      pythonExecutable: "python",
      cacheDirectory,
      compilerRunner: runner,
      nativePackageVerifier: verifier,
      llamaCpp,
    });
    expect(prepared).toHaveLength(1);
    const process = prepared[0]!;
    const args = runner.mock.calls[0]![1];
    expect(args.slice(0, 4)).toEqual(["-u", "-m", "distributed_runtime.native_gguf_remote", "fetch-stage"]);
    expect(flagValue(args, "--manifest-url")).toBe(source().tensorManifestUrl);
    expect(flagValue(args, "--manifest-id")).toBe(source().tensorManifestId);
    expect(flagValue(args, "--model-revision")).toBe("c".repeat(40));
    expect(args).toContain("--reuse-verified");
    if (process.kind === "cell-member" || process.nativeGguf === null) throw new Error("binding is missing");
    expect(process.nativeGguf.packageId).toBe("3".repeat(64));
    expect(process.nativeGguf.packagePath.startsWith(join(cacheDirectory, "native-gguf-stages"))).toBe(true);
    expect(verifier).toHaveBeenCalledWith(process.nativeGguf, undefined);
    expect(flagValue(process.command.args, "--llama-cpp-build-dir")).toBe(llamaCpp.buildDirectory);
    expect(flagValue(process.command.args, "--llama-cpp-gpu-layers")).toBe(String(process.layerEnd - process.layerStart + 1));
    expect(flagValue(process.command.args, "--stage-package-identity")).toBe(`sha256:${"3".repeat(64)}`);
    expect(() => validateLaunchAgentRpcStartRequest({
      launchId: description.launchId,
      pipelineId: description.pipelineId,
      deploymentGeneration: description.deploymentGeneration,
      nodeId: "node-b",
      process,
    })).not.toThrow();
    const original = description.launchOrder.find((candidate) => candidate.processId === process.processId)!;
    expect(() => validateLaunchAgentRpcStartRequest({
      launchId: description.launchId,
      pipelineId: description.pipelineId,
      deploymentGeneration: description.deploymentGeneration,
      nodeId: "node-b",
      process: { ...original, command: { ...original.command, args: [...original.command.args, "--llama-cpp-build-dir", "C:\\x"] } },
    })).toThrow("llama_cpp_executor_requires_native_gguf_package");
  });

  it("admits llama.cpp host flags only beside the executor and a native package", () => {
    const host = ["--llama-cpp-build-dir", "C:\\b", "--llama-cpp-build", llamaCpp.build, "--llama-cpp-view-cache", "C:\\v"];
    expect(() => validateNativeGgufExecutorArguments(["--native-gguf-executor", "llama-cpp", ...host], true)).not.toThrow();
    expect(() => validateNativeGgufExecutorArguments(["--native-gguf-executor", "torch", ...host], true))
      .toThrow("llama_cpp_flags_require_llama_cpp_executor");
    expect(() => validateNativeGgufExecutorArguments(["--native-gguf-executor", "llama-cpp", "--native-gguf-executor", "torch"], true))
      .toThrow("native_gguf_executor_flag_is_repeated");
    expect(() => validateNativeGgufExecutorArguments(["--native-gguf-executor", "llama-cpp", ...host.slice(0, 2)], true))
      .toThrow("llama_cpp_flag_is_missing:--llama-cpp-build");
    expect(() => validateNativeGgufExecutorArguments(
      ["--native-gguf-executor", "llama-cpp", ...host.slice(0, 3), "../evil", ...host.slice(4)], true,
    )).toThrow("llama_cpp_build_is_invalid");
  });

  it("installs the pinned llama.cpp build on demand before building the stage", async () => {
    const cacheDirectory = temporaryDirectory();
    const fetch = fetchRunner();
    const runner = vi.fn(async (executable: string, args: readonly string[]) => {
      if (!args.includes("distributed_runtime.llama_cpp_install")) return fetch(executable, args);
      const cache = flagValue(args, "--cache");
      return JSON.stringify({ build: llamaCpp.build, buildDirectory: join(cache, llamaCpp.build), gpuOffload: false });
    });
    const prepared = await prepareNodeStageArtifacts(sourceDescription(), {
      nodeId: "node-b", pythonExecutable: "python", cacheDirectory, compilerRunner: runner,
      nativePackageVerifier: async () => undefined,
    });
    expect(runner.mock.calls[0]![1]).toEqual(["-u", "-m", "distributed_runtime.llama_cpp_install",
      "--cache", join(cacheDirectory, "llama-cpp-builds")]);
    expect(runner).toHaveBeenCalledTimes(2);
    const args = prepared[0]!.command.args;
    expect(flagValue(args, "--llama-cpp-build-dir")).toBe(join(cacheDirectory, "llama-cpp-builds", llamaCpp.build));
    expect(flagValue(args, "--llama-cpp-build")).toBe(llamaCpp.build);
    expect(flagValue(args, "--llama-cpp-gpu-layers")).toBe("0");
  });

  it("fails closed when llama.cpp cannot be installed or names a path outside its cache", async () => {
    const answer = (value: unknown) => vi.fn(async () => {
      if (value instanceof Error) throw value;
      return JSON.stringify(value);
    });
    await expect(prepareNodeStageArtifacts(sourceDescription(), {
      nodeId: "node-b", pythonExecutable: "python", cacheDirectory: temporaryDirectory(),
      compilerRunner: answer(new Error("stage_artifact_preparation_failed:llama_cpp_build_unavailable_for_platform:linux-aarch64")),
    })).rejects.toThrow("native_gguf_llama_cpp_runtime_unavailable:stage_artifact_preparation_failed:llama_cpp_build_unavailable_for_platform");
    await expect(prepareNodeStageArtifacts(sourceDescription(), {
      nodeId: "node-b", pythonExecutable: "python", cacheDirectory: temporaryDirectory(),
      compilerRunner: answer({ build: llamaCpp.build, buildDirectory: "C:\\elsewhere", gpuOffload: true }),
    })).rejects.toThrow("native_gguf_llama_cpp_installer_returned_invalid_result");
  });

  it("fails closed when the package names another model", async () => {
    await expect(prepareNodeStageArtifacts(sourceDescription("torch"), {
      nodeId: "node-b", pythonExecutable: "python", cacheDirectory: temporaryDirectory(),
      compilerRunner: fetchRunner({ modelIdentity: `sha256:${"8".repeat(64)}` }),
      nativePackageVerifier: async () => undefined,
    })).rejects.toThrow("native_gguf_source_returned_wrong_model_identity");
    const torch = await prepareNodeStageArtifacts(sourceDescription("torch"), {
      nodeId: "node-b", pythonExecutable: "python", cacheDirectory: temporaryDirectory(),
      compilerRunner: fetchRunner(), nativePackageVerifier: async () => undefined,
    });
    expect(torch[0]!.command.args).not.toContain("--llama-cpp-build-dir");
  });
});

function fixture(): PythonPipelineLaunchDescription {
  return compileAutoDistribution(configFixture(), profileFixture()).launch;
}

interface NativeFixture {
  description: PythonPipelineLaunchDescription;
  nodeId: string;
  weightsPath: string;
  weightsSize: number;
}

function nativeFixture(stageIndex = 1): NativeFixture {
  const base = fixture();
  const target = base.sourceManifest.plans.prefill.stages[stageIndex]!;
  const packageRoot = join(temporaryDirectory(), "native-stage-package");
  mkdirSync(packageRoot);
  const weights = Buffer.from("sealed-native-gguf-stage-bytes");
  const config = Buffer.from('{"model_type":"llama"}');
  const weightsPath = join(packageRoot, "native-stage.gguf");
  writeFileSync(weightsPath, weights);
  writeFileSync(join(packageRoot, "config.json"), config);
  const sourceGgufSha256 = "9".repeat(64);
  const configSha256 = sha256(config);
  const modelSource = "mycellios://models/native-fixture";
  const modelRevision = "native-fixture-r1";
  const modelIdentity = `sha256:${sha256Text(canonicalEvidenceJson({
    schema: "gdlp-native-gguf-model-identity/1",
    sourceGgufSha256,
    configSha256,
  }))}`;
  const withoutPackageId = {
    schema: "gdlp-native-gguf-stage/1",
    model: {
      source: modelSource,
      revision: modelRevision,
      architecture: "llama",
      sourceGgufSha256,
    },
    stage: {
      layerStart: target.layerStart,
      layerEnd: target.layerEnd,
      totalLayers: base.totalLayers,
      first: target.layerStart === 0,
      last: target.layerEnd === base.totalLayers,
    },
    files: {
      "native-stage.gguf": {
        sizeBytes: weights.byteLength,
        sha256: sha256(weights),
      },
      "config.json": {
        sizeBytes: config.byteLength,
        sha256: configSha256,
      },
    },
    tensors: [{
      name: `blk.${target.layerStart}.attn_norm.weight`,
      dimensions: [1],
      ggmlType: 0,
      sizeBytes: 4,
    }],
    execution: {
      engine: "mycellios-native-gguf",
      externalRuntimeRequired: false,
      materialization: "stage-only-dequantize-to-torch",
      tensorLayout: "llama-rope-qk-permuted",
      executableGgmlTypes: [
        0, 1, 2, 3, 6, 7, 8, 10, 11, 12, 13, 14, 15, 24, 25, 26, 27, 28, 30,
      ],
    },
  };
  const packageId = sha256Text(canonicalEvidenceJson(withoutPackageId));
  writeFileSync(
    join(packageRoot, "native-stage.json"),
    `${JSON.stringify({ ...withoutPackageId, packageId })}\n`,
  );
  const snapshotIdentity = BigInt(`0x${modelIdentity.slice(7, 23)}`).toString();
  const description = compilePythonLaunchDescription(base.sourceManifest, {
    ...base.configuration,
    runtimeModel: {
      source: "native-fixture-root",
      revision: null,
      snapshotIdentity,
      artifactIdentity: modelIdentity,
      canonicalSource: modelSource,
      canonicalRevision: modelRevision,
    },
    nativeGgufStages: {
      [target.stageId]: {
        packagePath: packageRoot,
        packageId,
        modelIdentity,
        modelSource,
        modelRevision,
        layerStart: target.layerStart,
        layerEnd: target.layerEnd,
        totalLayers: base.totalLayers,
      },
    },
  });
  const native = description.launchOrder.find(
    (process) => process.kind !== "cell-member" && process.nativeGguf !== null,
  );
  if (!native) throw new Error("native fixture did not produce a native process");
  return {
    description,
    nodeId: native.anchor.memberId,
    weightsPath,
    weightsSize: weights.byteLength,
  };
}

function localNativeProcess(
  description: PythonPipelineLaunchDescription,
  nodeId: string,
): PythonLaunchProcess {
  const process = description.launchOrder.find(
    (candidate) =>
      candidate.anchor.memberId === nodeId
      && candidate.kind !== "cell-member"
      && candidate.nativeGguf !== null,
  );
  if (!process) throw new Error("native process is missing");
  return process;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function configFixture(): AutoDistributionConfig {
  return {
    schema: "gdlp-auto-distribute/1",
    model: { source: "org/model", revision: "commit-1", publicName: "fixture" },
    nodes: [
      {
        id: "node-a",
        region: "test",
        endpoint: { host: "node-a", port: 9_851 },
        memoryMiB: 2_048,
        reserveMiB: 256,
        decodeScale: 1,
        prefillScale: 1,
        codecScale: 1,
        powerWatts: 20,
        availability: 0.99,
        agent: { kind: "managed" },
      },
      {
        id: "node-b",
        region: "test",
        endpoint: { host: "node-b", port: 9_852 },
        memoryMiB: 2_048,
        reserveMiB: 256,
        decodeScale: 1,
        prefillScale: 1,
        codecScale: 1,
        powerWatts: 20,
        availability: 0.99,
        agent: { kind: "managed" },
      },
    ],
    links: [],
    distribution: { minimumStages: 2, maximumStages: 2, allowLossyActivation: false },
    workload: {
      promptTokens: 8,
      outputTokens: 8,
      contextTokens: 128,
      concurrentSequences: 1,
      minRouteAvailability: 0.9,
      batchWindowMs: 0,
      p95: true,
    },
    runtime: {
      pythonExecutable: "python",
      pythonPath: "python",
      hfHome: "runtime/hf-cache",
      apiEndpoint: { host: "0.0.0.0", port: 9_860 },
      apiAdvertiseHost: "node-a",
      returnEndpoint: { host: "node-a", port: 9_861 },
      returnBindHost: "0.0.0.0",
      threadsPerStage: 1,
      connectTimeoutSeconds: 60,
      readinessTimeoutMs: 120_000,
      maxOutputTokens: 128,
    },
    canary: { prompt: "OK", maxTokens: 8, timeoutMs: 120_000 },
  };
}

function profileFixture(): CompiledModelProfile {
  const snapshotHex = "0000000000003039";
  const artifactIdentity = `sha256:${snapshotHex}${"a".repeat(48)}`;
  return {
    schema: "gdlp-model-profile/1",
    source: {
      model: "org/model",
      revision: "commit-1",
      snapshotCommit: "commit-1",
      snapshotIdentityUint64Hex: snapshotHex,
      artifactIdentity,
      canonicalSource: `content-addressed://${artifactIdentity}`,
      canonicalRevision: artifactIdentity,
      format: "safetensors",
    },
    inspection: { architecture: "LlamaForCausalLM", calibrationRequired: true },
    compatibility: {
      selectiveSafetensors: true,
      requiresAdapter: false,
      adapterId: "transformers-llama-v1",
      reasons: [],
    },
    model: modelProfile(),
  };
}

function modelProfile(): DistributedModelProfile {
  const mib = 1024 * 1024;
  return {
    id: "org/model",
    layers: Array.from({ length: 8 }, (_value, index) => ({
      index,
      weightBytes: 32 * mib,
      activationElements: 512,
      kvBytesPerToken: 128,
      decodeMsAtUnit: 1,
      prefillMsPerTokenAtUnit: 0.1,
    })),
    embeddingBytes: 16 * mib,
    lmHeadBytes: 16 * mib,
    tiedEmbeddingAndHead: false,
    runtimeOverheadBytesPerStage: 256 * mib,
    embeddingDecodeMsAtUnit: 0,
    lmHeadDecodeMsAtUnit: 0,
    embeddingPrefillMsPerTokenAtUnit: 0,
    lmHeadPrefillMsPerTokenAtUnit: 0,
  };
}

function flagValue(args: readonly string[], flag: string): string {
  const index = args.lastIndexOf(flag);
  if (index < 0 || index + 1 >= args.length) throw new Error(`missing ${flag}`);
  return args[index + 1]!;
}

function flagDestination(args: readonly string[]): string {
  const module = args.indexOf("distributed_runtime.stage_artifact");
  if (module < 0 || module + 2 >= args.length) throw new Error("missing compiler destination");
  return args[module + 2]!;
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mycellios-stage-preparer-"));
  temporaryDirectories.push(directory);
  return directory;
}
