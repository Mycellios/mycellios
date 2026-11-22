import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AdapterChunk, InferenceAdapter } from "../src/adapters/base.js";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_FILE_BYTES, MEMORY_EMBEDDING_FILES, MEMORY_EMBEDDING_MODEL, approvedMemoryEmbeddingExecution } from "../src/contracts/memory-embedding.js";
import { NODE_REPLICAS_SCHEMA } from "../src/contracts/node-replicas.js";
import { deploymentSchema } from "../src/contracts/schemas.js";
import type { LaunchAgent, LaunchProcessHandle } from "../src/distribution/launch-supervisor.js";
import { MEMORY_EMBEDDING_ARTIFACT_BYTES, MemoryEmbeddingArtifactStore, type PinnedFile } from "../src/node/memory-embedding-artifact.js";
import {
  MemoryEmbeddingNodeReplica, memoryEmbeddingDeployment, selectMemoryEmbeddingExecution, trackStageActivity,
  type MemoryEmbeddingReplicaOptions, type ReplicaLaunchConfig, type ReplicaNodeState,
} from "../src/node/memory-embedding-replica.js";

const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

describe("memory embedding device selection per node hardware", () => {
  const select = (accelerator: Parameters<typeof selectMemoryEmbeddingExecution>[0]["accelerator"], platform: NodeJS.Platform = "win32", arch = "x64", failed: string[] = []) =>
    selectMemoryEmbeddingExecution({ platform, arch, accelerator, cpuName: "Test CPU", failedBackends: new Set(failed) });

  it("picks the measured pair for each verified accelerator", () => {
    expect(select({ status: "gpu-ready", effectiveBackend: "cuda", launchDevice: "cuda:1", deviceName: "RTX 2060" }))
      .toMatchObject({ backend: "cuda", precision: "float16", deviceType: "gpu", deviceIndex: 1 });
    expect(select({ status: "gpu-ready", effectiveBackend: "directml", launchDevice: "directml:0", deviceName: "Radeon 890M" }))
      .toMatchObject({ backend: "directml", precision: "float32", microBatchTokens: 1024, deviceIndex: 0 });
    expect(select({ status: "gpu-ready", effectiveBackend: "mps", launchDevice: "mps", deviceName: "Apple M1" }, "darwin", "arm64"))
      .toMatchObject({ backend: "mps", precision: "float16" });
    // A Mac node whose stage probe reports CPU only still has MPS for this replica.
    expect(select({ status: "cpu-ready", effectiveBackend: "cpu", launchDevice: "cpu", deviceName: "CPU" }, "darwin", "arm64"))
      .toMatchObject({ backend: "mps", precision: "float16" });
  });

  it("uses CPU fp32 where no measured accelerator pair exists or the accelerator failed", () => {
    for (const choice of [
      select(undefined),
      select({ status: "gpu-ready", effectiveBackend: "rocm", launchDevice: "cuda:0", deviceName: "Radeon" }),
      select({ status: "gpu-ready", effectiveBackend: "xpu", launchDevice: "xpu:0", deviceName: "Arc" }),
      select({ status: "gpu-fallback", effectiveBackend: "cpu", launchDevice: "cpu", deviceName: "CPU" }),
      select({ status: "gpu-ready", effectiveBackend: "cuda", launchDevice: "cuda:0", deviceName: "RTX" }, "win32", "x64", ["cuda"]),
      select(undefined, "darwin", "arm64", ["mps"]),
      select(undefined, "darwin", "x64"),
    ]) expect(choice).toMatchObject({ backend: "cpu", precision: "float32", deviceType: "cpu", deviceName: "Test CPU" });
  });

  it("advertises only approved single-stage deployments bound to the activation", () => {
    for (const choice of [
      select({ status: "gpu-ready", effectiveBackend: "cuda", launchDevice: "cuda:0", deviceName: "RTX" }),
      select({ status: "gpu-ready", effectiveBackend: "directml", launchDevice: "directml:0", deviceName: "Radeon" }),
      select(undefined, "darwin", "arm64"),
      select(undefined),
    ]) {
      const deployment = memoryEmbeddingDeployment({ activationId: "act-1", nodeId: "node-1", choice, freeSlots: 1 });
      expect(deploymentSchema.parse(deployment)).toBeTruthy();
      expect(approvedMemoryEmbeddingExecution(deployment.execution)).toEqual({ backend: choice.backend, precision: choice.precision });
      expect(deployment).toMatchObject({ model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, maxConcurrency: 1, adapter: "embedding" });
      expect(memoryEmbeddingDeployment({ activationId: "act-2", nodeId: "node-1", choice, freeSlots: 1 }).deploymentId).not.toBe(deployment.deploymentId);
    }
  });
});

describe("hash-pinned memory embedding artifact", () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "memory-embedding-artifact-")); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  const content = { "a.json": "{\"pinned\":true}", "weights.bin": "0123456789".repeat(100) };
  const files: Record<string, PinnedFile> = Object.fromEntries(Object.entries(content).map(([name, value]) => [name, { bytes: value.length, sha256: sha(value) }]));
  const budget = (maxCacheBytes = 10 * 1024 ** 3, cacheBytes = 0) => ({ maxCacheBytes: async () => maxCacheBytes, cacheBytes: async () => cacheBytes });
  function server(serve: Record<string, string> = content) {
    const requests: Array<{ url: string; range: string | null }> = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const name = String(url).split("/").at(-1)!;
      const range = new Headers(init?.headers).get("range");
      requests.push({ url: String(url), range });
      const body = serve[name]!;
      const start = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0;
      return new Response(body.slice(start), { status: range ? 206 : 200 });
    }) as unknown as typeof fetch;
    return { requests, fetchImpl };
  }

  it("pins the real files with their exact sizes", () => {
    expect(Object.keys(MEMORY_EMBEDDING_FILE_BYTES).sort()).toEqual(Object.keys(MEMORY_EMBEDDING_FILES).sort());
    expect(MEMORY_EMBEDDING_ARTIFACT_BYTES).toBe(1_207_469_357);
  });

  it("installs files only from the pinned revision after their size and sha256 match", async () => {
    const { requests, fetchImpl } = server();
    const store = new MemoryEmbeddingArtifactStore(root, { fetch: fetchImpl, files, freeBytes: async () => 100 * 1024 ** 3 });
    const path = await store.ensure(budget(), new AbortController().signal);
    expect(readFileSync(join(path, "weights.bin"), "utf8")).toBe(content["weights.bin"]);
    expect(requests.every((request) => request.url.startsWith("https://huggingface.co/Qwen/Qwen3-Embedding-0.6B/resolve/97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3/"))).toBe(true);
    expect(await store.installed()).toBe(true);
    // Installed artifacts are not downloaded again.
    requests.length = 0;
    await store.ensure(budget(), new AbortController().signal);
    expect(requests).toEqual([]);
  });

  it("refuses tampered bytes and installs nothing", async () => {
    const { fetchImpl } = server({ ...content, "weights.bin": "9".repeat(1000) });
    const store = new MemoryEmbeddingArtifactStore(root, { fetch: fetchImpl, files, freeBytes: async () => 100 * 1024 ** 3 });
    await expect(store.ensure(budget(), new AbortController().signal)).rejects.toThrow("memory_embedding_artifact_mismatch:weights.bin");
    expect(existsSync(join(store.modelPath, "weights.bin"))).toBe(false);
    expect(existsSync(join(store.modelPath, "weights.bin.part"))).toBe(false);
    expect(await store.installed()).toBe(false);
  });

  it("resumes a partial download with a range request", async () => {
    const { requests, fetchImpl } = server();
    const store = new MemoryEmbeddingArtifactStore(root, { fetch: fetchImpl, files, freeBytes: async () => 100 * 1024 ** 3 });
    mkdirSync(store.modelPath, { recursive: true });
    writeFileSync(join(store.modelPath, "weights.bin.part"), content["weights.bin"].slice(0, 400));
    await store.ensure(budget(), new AbortController().signal);
    expect(requests.find((request) => request.url.endsWith("weights.bin"))?.range).toBe("bytes=400-");
    expect(await store.installed()).toBe(true);
  });

  it("downloads nothing when the files would exceed the owner's disk limit or the free space", async () => {
    const { requests, fetchImpl } = server();
    const store = new MemoryEmbeddingArtifactStore(root, { fetch: fetchImpl, files, freeBytes: async () => 100 * 1024 ** 3 });
    await expect(store.ensure(budget(512 * 1024 ** 2, 300 * 1024 ** 2), new AbortController().signal)).rejects.toThrow("memory_embedding_artifact_exceeds_disk_limit");
    const full = new MemoryEmbeddingArtifactStore(root, { fetch: fetchImpl, files, freeBytes: async () => 10 });
    await expect(full.ensure(budget(), new AbortController().signal)).rejects.toThrow("memory_embedding_artifact_insufficient_free_space");
    expect(requests).toEqual([]);
  });

  it("evicts other artifact identities", async () => {
    const stale = join(root, "f".repeat(64));
    mkdirSync(stale, { recursive: true });
    const store = new MemoryEmbeddingArtifactStore(root, { fetch: server().fetchImpl, files, freeBytes: async () => 100 * 1024 ** 3 });
    await store.ensure(budget(), new AbortController().signal);
    expect(existsSync(stale)).toBe(false);
  });
});

describe("node-managed memory embedding replica", () => {
  const idleState = (overrides: Partial<ReplicaNodeState> = {}): ReplicaNodeState => ({
    contributionEnabled: true, draining: false, policyRejection: null,
    limits: { maxCpuPercent: 50, maxRamMiB: 16_384, maxDiskMiB: 40_000, maxTemperatureC: 85 },
    offeredVramMiB: 6_144, nodeRssMiB: 200, activeStages: 0, ...overrides,
  });
  function harness(options: { desired?: boolean; status?: number; state?: Partial<ReplicaNodeState>; accelerator?: "cuda" | null } = {}) {
    let clock = 1_000_000;
    let desired = options.desired ?? true;
    let state = idleState(options.state);
    const launches: ReplicaLaunchConfig[] = [];
    const stops: string[] = [];
    let ready = true;
    const adapter: InferenceAdapter = {
      kind: "embedding",
      probe: async () => ({ kind: "embedding", models: [MEMORY_EMBEDDING_MODEL], streaming: true, embeddings: true, reranking: false }),
      warm: async () => undefined,
      metrics: async () => ({ ready, activeJobs: 0, loadedModels: [] }),
      cancel: async () => undefined,
      async *generate(): AsyncIterable<AdapterChunk> { yield { index: 0, text: "{}" }; },
    };
    const replicaOptions: MemoryEmbeddingReplicaOptions = {
      nodeId: "node-1", coordinatorUrl: "https://coordinator.test", session: () => ({ token: "session" }),
      state: async () => state,
      choose: (failed) => selectMemoryEmbeddingExecution({ platform: "win32", arch: "x64", cpuName: "CPU", failedBackends: failed,
        accelerator: options.accelerator === null ? undefined : { status: "gpu-ready", effectiveBackend: "cuda", launchDevice: "cuda:0", deviceName: "RTX" } }),
      artifacts: { modelPath: "/models", ensure: async () => "/models" },
      budget: { maxCacheBytes: async () => 0, cacheBytes: async () => 0 },
      launch: async (config) => {
        launches.push(config);
        let exit!: (code: number | null) => void;
        const exited = new Promise<number | null>((resolve) => { exit = resolve; });
        return { exited, stop: async () => { stops.push(config.activationId); exit(0); } };
      },
      adapter: () => adapter,
      fetch: (async (url: string | URL, init?: RequestInit) => {
        expect(String(url)).toBe("https://coordinator.test/internal/v1/nodes/node-1/replicas");
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session");
        if (options.status) return new Response("{}", { status: options.status });
        return Response.json({ schema: NODE_REPLICAS_SCHEMA, nodeId: "node-1", replicas: [{ model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, desired }] });
      }) as unknown as typeof fetch,
      freeMemoryMiB: () => 32_000,
      now: () => clock, minResidencyMs: 180_000,
    };
    const replica = new MemoryEmbeddingNodeReplica(replicaOptions);
    return {
      replica, launches, stops,
      setDesired: (value: boolean) => { desired = value; },
      setState: (value: Partial<ReplicaNodeState>) => { state = idleState(value); },
      setReady: (value: boolean) => { ready = value; },
      advance: (ms: number) => { clock += ms; },
      async settle() { await replica.tick(); await replica.tick(); },
    };
  }

  it("starts on demand on the best device, with the owner's CPU share and thermal margin, and advertises one slot", async () => {
    const h = harness();
    await h.settle();
    expect(h.launches).toHaveLength(1);
    expect(h.launches[0]).toMatchObject({ choice: { backend: "cuda", precision: "float16" }, thermal: { pauseC: 81, resumeC: 76 } });
    expect(h.launches[0]!.threads).toBeGreaterThanOrEqual(1);
    const [deployment] = h.replica.deployments();
    expect(deployment).toMatchObject({ model: MEMORY_EMBEDDING_MODEL, activationId: h.launches[0]!.activationId, freeSlots: 1 });
    expect(h.replica.adapterFor(MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_DIGEST)).not.toBeNull();
    expect(h.replica.adapterFor(MEMORY_EMBEDDING_MODEL, `sha256:${"0".repeat(64)}`)).toBeNull();
    expect(h.replica.adapterFor("other-model", MEMORY_EMBEDDING_DIGEST)).toBeNull();
  });

  it("does not start without demand, on an older coordinator, or when the owner's limits do not allow it", async () => {
    for (const h of [
      harness({ desired: false }),
      harness({ status: 404 }),
      harness({ state: { contributionEnabled: false } }),
      harness({ state: { draining: true } }),
      harness({ state: { policyRejection: "model_not_allowed" } }),
      harness({ state: { activeStages: 1 } }),
    ]) {
      await h.settle();
      expect(h.launches).toEqual([]);
      expect(h.replica.deployments()).toEqual([]);
    }
    const tight = harness({ state: { limits: { maxCpuPercent: 50, maxRamMiB: 2_000, maxDiskMiB: 40_000, maxTemperatureC: 85 } } });
    await tight.settle();
    expect(tight.launches).toEqual([]);
  });

  it("uses the CPU when the owner's accelerator offer is too small for the GPU replica", async () => {
    const h = harness({ state: { offeredVramMiB: 1_024 } });
    await h.settle();
    expect(h.launches[0]?.choice).toMatchObject({ backend: "cpu", precision: "float32" });
  });

  it("does not advertise until the runtime reports ready", async () => {
    const h = harness();
    h.setReady(false);
    await h.settle();
    expect(h.launches).toHaveLength(1);
    expect(h.replica.deployments()).toEqual([]);
    expect(h.replica.adapterFor(MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_DIGEST)).toBeNull();
  });

  it("unloads when demand ends only after the minimum residency, and at once when the owner pauses", async () => {
    const h = harness();
    await h.settle();
    h.setDesired(false);
    h.advance(60_000);
    await h.settle();
    expect(h.stops).toEqual([]);
    h.advance(180_000);
    await h.settle();
    expect(h.stops).toHaveLength(1);
    expect(h.replica.deployments()).toEqual([]);

    const paused = harness();
    await paused.settle();
    paused.setState({ contributionEnabled: false });
    await paused.settle();
    expect(paused.stops).toHaveLength(1);
  });

  it("yields to a distributed stage before it prepares or starts", async () => {
    const h = harness();
    await h.settle();
    const handle: LaunchProcessHandle = { ready: Promise.resolve(), exited: new Promise(() => undefined), stop: async () => undefined };
    const base: LaunchAgent = { id: "stage", prepareRuntime: async () => [], start: async () => handle };
    const tracked = trackStageActivity(base, async () => { await h.replica.yieldToStage(); });
    await tracked.agent.prepareRuntime!({} as never, "node-1");
    expect(h.stops).toHaveLength(1);
    await tracked.agent.start({} as never, new AbortController().signal);
    expect(tracked.active()).toBe(1);
    h.setState({ activeStages: tracked.active() });
    await h.settle();
    expect(h.launches).toHaveLength(1);
  });

  it("serves one request at a time through its single slot", async () => {
    const h = harness();
    await h.settle();
    const adapter = h.replica.adapterFor(MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_DIGEST)!;
    const first = adapter.generate({ jobId: "a", request: {} as never }, new AbortController().signal)[Symbol.asyncIterator]();
    await first.next();
    expect(h.replica.deployments()[0]?.freeSlots).toBe(0);
    const second = adapter.generate({ jobId: "b", request: {} as never }, new AbortController().signal)[Symbol.asyncIterator]();
    await expect(second.next()).rejects.toThrow("memory_embedding_replica_busy");
    await first.next();
    expect(h.replica.deployments()[0]?.freeSlots).toBe(1);
  });
});
