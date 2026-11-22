import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { constants as osConstants, cpus, freemem, setPriority } from "node:os";
import { join } from "node:path";
import { MemoryEmbeddingAdapter } from "../adapters/memory-embedding.js";
import type { AdapterChunk, AdapterRequest, InferenceAdapter } from "../adapters/base.js";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_REVISION, approvedMemoryEmbeddingExecution } from "../contracts/memory-embedding.js";
import { nodeReplicasResponseSchema, NODE_REPLICAS_PATH_SUFFIX } from "../contracts/node-replicas.js";
import { deploymentSchema } from "../contracts/schemas.js";
import type { ModelDeployment } from "../contracts/types.js";
import { sha256Text } from "../core/json.js";
import type { LaunchAgent } from "../distribution/launch-supervisor.js";
import { buildIsolatedProcessEnvironment } from "../distribution/process-environment.js";
import { writeWindowsJobBrokerRequest } from "../distribution/windows-job-broker.js";
import type { NativeReplicaSlot } from "../worker/native-replica-slot.js";
import type { ArtifactBudget, MemoryEmbeddingArtifactStore } from "./memory-embedding-artifact.js";

/**
 * Automatic operator memory embedding replica on a paired native node
 * (specs/memory-embedding-qwen06/spec.md, "Automatic node replicas").
 *
 * While the coordinator reports demand from the node's own owner account,
 * an idle node that the owner lets contribute downloads the pinned files,
 * starts `qwen06_embedding_service.py` in native loopback mode on the best
 * measured device of this machine, and advertises the deployment through its
 * own WorkerAgent. It stops the replica when demand ends (after a minimum
 * residency), when the owner pauses or drains, when the work policy excludes
 * the model, when the memory budget no longer fits, and before the node
 * prepares or starts a distributed stage.
 */
export interface MemoryEmbeddingExecutionChoice {
  backend: "cuda" | "mps" | "directml" | "cpu";
  precision: "float16" | "float32";
  deviceType: "gpu" | "cpu";
  deviceName: string;
  deviceIndex: number | null;
  /** Padded tokens per micro-batch; DirectML only runs 1024. */
  microBatchTokens: number;
  /** Host memory the process needs (weights, tokenizer, activations). */
  hostMemoryMiB: number;
  /** Accelerator memory the process needs; 0 on CPU. */
  peakVramMiB: number;
}

export interface AcceleratorFacts {
  status: "cpu-ready" | "gpu-ready" | "gpu-fallback";
  effectiveBackend: string;
  launchDevice: string;
  deviceName: string;
}

const CPU_CHOICE = (deviceName: string): MemoryEmbeddingExecutionChoice => ({ backend: "cpu", precision: "float32", deviceType: "cpu",
  deviceName, deviceIndex: null, microBatchTokens: 4096, hostMemoryMiB: 3584, peakVramMiB: 0 });

/**
 * Best measured device/precision for this node, from the accelerator the
 * node already verified. Only pairs measured at cosine ≥ 0.999996 against CPU
 * fp32 are chosen (CUDA fp16, Apple MPS fp16, DirectML fp32, CPU fp32);
 * ROCm and XPU have no measured pair yet and use the CPU. A backend that
 * failed to load on this node falls back to the CPU.
 */
export function selectMemoryEmbeddingExecution(input: {
  platform: NodeJS.Platform; arch: string; accelerator?: AcceleratorFacts | undefined; cpuName: string;
  failedBackends?: ReadonlySet<string>;
}): MemoryEmbeddingExecutionChoice {
  const failed = input.failedBackends ?? new Set<string>();
  const accelerator = input.accelerator?.status === "gpu-ready" ? input.accelerator : undefined;
  const index = (device: string | undefined) => {
    const value = Number(device?.split(":")[1]);
    return Number.isInteger(value) && value >= 0 && value <= 64 ? value : 0;
  };
  if (accelerator?.effectiveBackend === "cuda" && !failed.has("cuda")) {
    return { backend: "cuda", precision: "float16", deviceType: "gpu", deviceName: accelerator.deviceName,
      deviceIndex: index(accelerator.launchDevice), microBatchTokens: 16_384, hostMemoryMiB: 2048, peakVramMiB: 2048 };
  }
  if (accelerator?.effectiveBackend === "directml" && !failed.has("directml")) {
    // float16 on DirectML drifted to cosine 0.987; larger micro-batches and fused SDPA fail on the measured driver.
    return { backend: "directml", precision: "float32", deviceType: "gpu", deviceName: accelerator.deviceName,
      deviceIndex: index(accelerator.launchDevice), microBatchTokens: 1024, hostMemoryMiB: 3072, peakVramMiB: 3072 };
  }
  // Apple Silicon always has MPS on the supported macOS versions; the node's own stage probe may not report it.
  if ((accelerator?.effectiveBackend === "mps" || (input.platform === "darwin" && input.arch === "arm64")) && !failed.has("mps")) {
    return { backend: "mps", precision: "float16", deviceType: "gpu", deviceName: accelerator?.deviceName ?? "Apple GPU",
      deviceIndex: null, microBatchTokens: 16_384, hostMemoryMiB: 3072, peakVramMiB: 0 };
  }
  return CPU_CHOICE(input.cpuName);
}

/** Deployment advertised by the node's WorkerAgent for one running activation. */
export function memoryEmbeddingDeployment(input: { activationId: string; nodeId: string; choice: MemoryEmbeddingExecutionChoice; freeSlots: number }): ModelDeployment {
  const { choice } = input;
  const stage = { nodeId: input.nodeId, stageIndex: 0, layerStart: 0, layerEnd: 28, deviceType: choice.deviceType,
    backend: choice.backend, deviceName: choice.deviceName, precision: choice.precision, fallback: false };
  const deployment = deploymentSchema.parse({
    deploymentId: `dep-${sha256Text([MEMORY_EMBEDDING_MODEL, "embedding", MEMORY_EMBEDDING_DIGEST, input.activationId].join(":")).slice(-12)}`,
    model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: input.activationId,
    mode: "replica", adapter: "embedding", peakVramMb: Math.max(512, choice.peakVramMiB), contextLimit: 524_288,
    maxConcurrency: 1, freeSlots: input.freeSlots, tokensPerSecond: 5, throughputSource: "default", ttftMs: 2_000,
    dataLocality: "local",
    execution: { deviceType: choice.deviceType, backend: choice.backend, deviceName: choice.deviceName,
      precision: choice.precision, fallback: false, stages: [stage] },
  }) as ModelDeployment;
  if (!approvedMemoryEmbeddingExecution(deployment.execution)) throw new Error("memory_embedding_execution_not_approved");
  return deployment;
}

/** Counts live distributed stage processes and lets the replica yield before a stage prepares or starts. */
export function trackStageActivity(agent: LaunchAgent, beforeStage: () => Promise<void>): { agent: LaunchAgent; active(): number } {
  let active = 0;
  const tracked: LaunchAgent = Object.create(agent) as LaunchAgent;
  if (agent.prepareRuntime) {
    tracked.prepareRuntime = async (...args) => { await beforeStage(); return await agent.prepareRuntime!(...args); };
  }
  tracked.start = async (request, signal) => {
    await beforeStage();
    active += 1;
    try {
      const handle = await agent.start(request, signal);
      void handle.exited.finally(() => { active -= 1; });
      return handle;
    } catch (error) { active -= 1; throw error; }
  };
  return { agent: tracked, active: () => active };
}

export interface ReplicaNodeState {
  contributionEnabled: boolean;
  draining: boolean;
  /** null when the owner's work policy admits the model right now. */
  policyRejection: string | null;
  limits: { maxCpuPercent: number; maxRamMiB: number; maxDiskMiB: number; maxTemperatureC: number };
  /** Accelerator memory the node offers (owner limit or detected), MiB. */
  offeredVramMiB: number;
  /** Resident memory of the node process, MiB. */
  nodeRssMiB: number;
  /** Live distributed stage processes on this node. */
  activeStages: number;
}

export interface ReplicaProcess {
  readonly exited: Promise<number | null>;
  stop(): Promise<void>;
}

export interface MemoryEmbeddingReplicaOptions {
  nodeId: string;
  coordinatorUrl: string;
  session(): { token: string } | null;
  state(): Promise<ReplicaNodeState>;
  choose(failedBackends: ReadonlySet<string>): MemoryEmbeddingExecutionChoice;
  artifacts: Pick<MemoryEmbeddingArtifactStore, "ensure" | "modelPath">;
  budget: ArtifactBudget;
  launch(config: ReplicaLaunchConfig): Promise<ReplicaProcess>;
  adapter?(options: ConstructorParameters<typeof MemoryEmbeddingAdapter>[0]): InferenceAdapter;
  fetch?: typeof fetch;
  freeMemoryMiB?(): number;
  logger?: { info(message: string): void; warn(message: string): void };
  tickMs?: number;
  /** A started replica stays at least this long unless the owner or a stage needs the node. */
  minResidencyMs?: number;
  now?(): number;
}

export interface ReplicaLaunchConfig {
  port: number;
  activationId: string;
  modelPath: string;
  choice: MemoryEmbeddingExecutionChoice;
  threads: number;
  thermal: { pauseC: number; resumeC: number };
}

type Phase = "idle" | "preparing" | "starting" | "ready" | "stopping";

export class MemoryEmbeddingNodeReplica implements NativeReplicaSlot {
  private phase: Phase = "idle";
  private running: { process: ReplicaProcess; adapter: InferenceAdapter; activationId: string; choice: MemoryEmbeddingExecutionChoice; startedAt: number; ready: boolean } | null = null;
  private activeJobs = 0;
  private desired = false;
  private desiredCheckedAt = 0;
  private readonly failedBackends = new Set<string>();
  private failures = 0;
  private retryAt = 0;
  private timer: NodeJS.Timeout | null = null;
  private ticking: Promise<void> | null = null;
  private preparation: AbortController | null = null;
  private lastIssue: string | null = null;

  constructor(private readonly options: MemoryEmbeddingReplicaOptions) {}

  start(): void {
    if (this.timer) return;
    const tick = () => { void this.tick(); };
    this.timer = setInterval(tick, this.options.tickMs ?? 15_000);
    this.timer.unref?.();
    tick();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.ticking?.catch(() => undefined);
    await this.unload("node_stopping");
  }

  /** Stops the replica before a distributed stage prepares or starts; stages have priority on the node. */
  async yieldToStage(): Promise<void> {
    await this.unload("stage_priority");
  }

  get status(): { phase: Phase; backend: string | null; issue: string | null } {
    return { phase: this.phase, backend: this.running?.choice.backend ?? null, issue: this.lastIssue };
  }

  deployments(): ModelDeployment[] {
    const running = this.running;
    if (!running?.ready || this.phase !== "ready") return [];
    return [memoryEmbeddingDeployment({ activationId: running.activationId, nodeId: this.options.nodeId, choice: running.choice,
      freeSlots: this.activeJobs === 0 ? 1 : 0 })];
  }

  adapterFor(model: string, modelDigest: string): InferenceAdapter | null {
    const running = this.running;
    if (model !== MEMORY_EMBEDDING_MODEL || modelDigest !== MEMORY_EMBEDDING_DIGEST || !running?.ready) return null;
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    // One request at a time: the replica advertises a single slot.
    return {
      kind: running.adapter.kind,
      probe: () => running.adapter.probe(),
      warm: (value) => running.adapter.warm(value),
      metrics: () => running.adapter.metrics(),
      cancel: (jobId) => running.adapter.cancel(jobId),
      async *generate(request: AdapterRequest, signal: AbortSignal): AsyncIterable<AdapterChunk> {
        if (self.activeJobs > 0) throw new Error("memory_embedding_replica_busy");
        self.activeJobs += 1;
        try { yield* running.adapter.generate(request, signal); } finally { self.activeJobs -= 1; }
      },
    };
  }

  async cancel(jobId: string): Promise<void> {
    await this.running?.adapter.cancel(jobId);
  }

  /** One reconciliation step; exported for tests. */
  async tick(): Promise<void> {
    if (this.ticking) return await this.ticking;
    this.ticking = this.reconcile().catch((error: unknown) => {
      this.lastIssue = error instanceof Error ? error.message.slice(0, 200) : "memory_embedding_replica_error";
      this.options.logger?.warn(`memory embedding replica: ${this.lastIssue}`);
    }).finally(() => { this.ticking = null; });
    return await this.ticking;
  }

  private now(): number { return this.options.now?.() ?? Date.now(); }

  private async reconcile(): Promise<void> {
    await this.refreshDesired();
    const state = await this.options.state();
    const blocked = this.blockedReason(state);
    if (this.running) {
      await this.refreshReadiness();
      if (blocked) return await this.unload(blocked);
      const resident = this.now() - this.running.startedAt;
      if (!this.desired && this.activeJobs === 0 && resident >= (this.options.minResidencyMs ?? 180_000)) await this.unload("idle");
      return;
    }
    if (!this.desired || blocked || this.now() < this.retryAt) {
      if (blocked) this.lastIssue = blocked;
      return;
    }
    await this.load(state);
  }

  private blockedReason(state: ReplicaNodeState): string | null {
    if (!state.contributionEnabled) return "contribution_paused";
    if (state.draining) return "node_draining";
    if (state.policyRejection) return state.policyRejection;
    if (state.activeStages > 0) return "stage_running";
    const choice = this.running?.choice ?? this.choiceFor(state);
    // Owner RAM limit covers the node and its replica; never start beyond free memory either.
    if (state.nodeRssMiB + choice.hostMemoryMiB > state.limits.maxRamMiB) return "memory_limit";
    // macOS reports reclaimable cache as used memory, so only the owner limit applies there.
    const free = this.options.freeMemoryMiB?.() ?? (process.platform === "darwin" ? Number.POSITIVE_INFINITY : freemem() / (1024 * 1024));
    if (!this.running && free < choice.hostMemoryMiB + 1024) return "memory_unavailable";
    if (!fitsVram(choice, state)) return "vram_limit";
    return null;
  }

  /** Best measured device whose accelerator memory fits the owner's offer; the CPU otherwise. */
  private choiceFor(state: ReplicaNodeState): MemoryEmbeddingExecutionChoice {
    const skipped = new Set(this.failedBackends);
    for (;;) {
      const choice = this.options.choose(skipped);
      if (choice.backend === "cpu" || fitsVram(choice, state)) return choice;
      skipped.add(choice.backend);
    }
  }

  private async refreshDesired(): Promise<void> {
    const session = this.options.session();
    if (!session) { this.desired = false; return; }
    try {
      const url = new URL(`/internal/v1/nodes/${encodeURIComponent(this.options.nodeId)}/${NODE_REPLICAS_PATH_SUFFIX}`, this.options.coordinatorUrl);
      const response = await (this.options.fetch ?? fetch)(url, { headers: { authorization: `Bearer ${session.token}` },
        redirect: "manual", signal: AbortSignal.timeout(10_000) });
      // An older coordinator has no route: nothing is desired.
      if (response.status === 404) { await response.body?.cancel(); this.desired = false; this.desiredCheckedAt = this.now(); return; }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`node_replicas_http_${response.status}`); }
      const body = nodeReplicasResponseSchema.parse(await response.json());
      if (body.nodeId !== this.options.nodeId) throw new Error("node_replicas_wrong_node");
      this.desired = body.replicas.some((replica) => replica.model === MEMORY_EMBEDDING_MODEL && replica.modelDigest === MEMORY_EMBEDDING_DIGEST && replica.desired);
      this.desiredCheckedAt = this.now();
    } catch (error) {
      // Keep the last answer briefly across a coordinator restart, then fail closed.
      if (this.now() - this.desiredCheckedAt > 120_000) this.desired = false;
      this.lastIssue = error instanceof Error ? error.message.slice(0, 200) : "node_replicas_unavailable";
    }
  }

  private async refreshReadiness(): Promise<void> {
    const running = this.running;
    if (!running) return;
    const metrics = await running.adapter.metrics().catch(() => ({ ready: false }));
    running.ready = metrics.ready;
    if (running.ready && this.phase === "starting") {
      this.phase = "ready";
      this.failures = 0;
      this.lastIssue = null;
      this.options.logger?.info(`memory embedding replica ready on ${running.choice.backend}/${running.choice.precision}`);
    }
    // Loading can take minutes on a CPU; a replica that never becomes ready is restarted with backoff.
    if (!running.ready && this.phase === "starting" && this.now() - running.startedAt > 10 * 60_000) {
      await this.unload("load_timeout");
      this.recordFailure(running.choice.backend);
    }
  }

  private async load(state: ReplicaNodeState): Promise<void> {
    const choice = this.choiceFor(state);
    this.phase = "preparing";
    this.preparation = new AbortController();
    let modelPath: string;
    try {
      modelPath = await this.options.artifacts.ensure(this.options.budget, this.preparation.signal);
    } catch (error) {
      this.phase = "idle";
      this.retryAt = this.now() + 30 * 60_000;
      throw error;
    } finally { this.preparation = null; }
    this.phase = "starting";
    const activationId = `mem-${randomUUID()}`;
    const port = await freeLoopbackPort();
    const threads = Math.max(1, Math.floor(cpus().length * Math.min(100, state.limits.maxCpuPercent) / 100));
    const process = await this.options.launch({ port, activationId, modelPath, choice, threads,
      thermal: { pauseC: state.limits.maxTemperatureC - 4, resumeC: state.limits.maxTemperatureC - 9 } });
    const adapter = (this.options.adapter ?? ((value) => new MemoryEmbeddingAdapter(value)))({
      baseUrl: `http://127.0.0.1:${port}/`, model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, activationId,
      execution: memoryEmbeddingDeployment({ activationId, nodeId: this.options.nodeId, choice, freeSlots: 1 }).execution,
    });
    const running = { process, adapter, activationId, choice, startedAt: this.now(), ready: false };
    this.running = running;
    void process.exited.then((code) => {
      if (this.running !== running) return;
      this.running = null;
      this.phase = "idle";
      this.lastIssue = `memory_embedding_runtime_exited:${code ?? "signal"}`;
      this.options.logger?.warn(this.lastIssue);
      this.recordFailure(choice.backend);
    });
    this.options.logger?.info(`memory embedding replica starting on ${choice.backend}/${choice.precision}`);
  }

  private recordFailure(backend: string): void {
    this.failures += 1;
    // A GPU backend that fails twice on this node is not retried; the CPU replica remains available.
    if (backend !== "cpu" && this.failures >= 2) this.failedBackends.add(backend);
    this.retryAt = this.now() + Math.min(60 * 60_000, 60_000 * 2 ** Math.min(6, this.failures));
  }

  private async unload(reason: string): Promise<void> {
    this.preparation?.abort(new Error(reason));
    const running = this.running;
    if (!running) return;
    this.phase = "stopping";
    this.running = null;
    await running.process.stop().catch(() => undefined);
    this.phase = "idle";
    if (reason !== "idle") this.lastIssue = reason;
    this.options.logger?.info(`memory embedding replica stopped: ${reason}`);
  }
}

function fitsVram(choice: MemoryEmbeddingExecutionChoice, state: ReplicaNodeState): boolean {
  // Apple GPUs share host memory, which the owner's RAM limit already covers.
  return choice.peakVramMiB === 0 || choice.backend === "mps" || choice.peakVramMiB <= state.offeredVramMiB;
}

async function freeLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("loopback_port_unavailable")));
    });
  });
}

/**
 * Starts the runtime from the node's Python product with the node's verified
 * accelerator interpreter, below normal priority, inside the Windows kill-on-close
 * Job when the node has the broker, offline from Hugging Face (the files are
 * already verified) and with the owner's CPU share as its thread count.
 */
export function pythonReplicaLauncher(options: {
  pythonExecutable: string; pythonPath: string; workspace: string; windowsJobBrokerExecutable?: string | undefined;
}): (config: ReplicaLaunchConfig) => Promise<ReplicaProcess> {
  return async (config) => {
    // One replica at a time: a fresh workspace per launch (the Job broker request file is write-once).
    await rm(options.workspace, { recursive: true, force: true });
    await mkdir(options.workspace, { recursive: true });
    const configPath = join(options.workspace, "replica.json");
    await writeFile(configPath, JSON.stringify({
      native: { host: "127.0.0.1", port: config.port, activationId: config.activationId },
      modelPath: config.modelPath, revision: MEMORY_EMBEDDING_REVISION,
      device: config.choice.backend, dtype: config.choice.precision,
      ...(config.choice.deviceIndex === null ? {} : { deviceIndex: config.choice.deviceIndex }),
      microBatchTokens: config.choice.microBatchTokens, threads: config.threads, lowPriority: true,
      thermal: config.thermal,
    }), { mode: 0o600 });
    const command = { executable: options.pythonExecutable, args: ["-B", "-m", "distributed_runtime.qwen06_embedding_service", "--config", configPath] };
    const broker = options.windowsJobBrokerExecutable && process.platform === "win32"
      ? writeWindowsJobBrokerRequest(options.workspace, command, options.workspace) : undefined;
    const child: ChildProcess = spawn(broker ? options.windowsJobBrokerExecutable! : command.executable, broker ? [broker] : command.args, {
      cwd: options.workspace, stdio: "ignore", windowsHide: true, shell: false,
      env: buildIsolatedProcessEnvironment({ overrides: {
        PYTHONPATH: options.pythonPath, PYTHONDONTWRITEBYTECODE: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
        OMP_NUM_THREADS: String(config.threads), MKL_NUM_THREADS: String(config.threads),
      }, additionalInheritedKeys: ["MYCELLIOS_DIRECTML_DEVICE_INDEX"] }),
    });
    try { if (child.pid) setPriority(child.pid, osConstants.priority.PRIORITY_BELOW_NORMAL); } catch { /* the runtime lowers itself too */ }
    const exited = new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", () => resolve(null));
    });
    return {
      exited,
      stop: async () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        child.kill();
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 10_000).unref());
        await Promise.race([exited, timeout]);
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      },
    };
  };
}

/** Wires the replica to a paired native node's configuration, control state and runtime (src/node/main.ts). */
export function createNodeMemoryEmbeddingReplica(input: {
  nodeId: string;
  coordinatorUrl: string;
  cachePath: string;
  workspace: string;
  pythonExecutable: string;
  pythonPath: string;
  windowsJobBrokerExecutable?: string | undefined;
  accelerator?: AcceleratorFacts | undefined;
  detectedVramMiB: number;
  session(): { token: string } | null;
  config(): Promise<{ limits: ReplicaNodeState["limits"] & { maxVramMiB: number }; policy?: unknown }>;
  control(): Promise<{ contributionEnabled: boolean; draining: boolean }>;
  contributionEnabled(): boolean;
  policyRejection(policy: unknown, model: string, at: Date): string | null;
  activeStages(): number;
  cacheBytes(): Promise<number>;
  logger?: MemoryEmbeddingReplicaOptions["logger"];
  artifacts: MemoryEmbeddingArtifactStore;
}): MemoryEmbeddingNodeReplica {
  const cpuName = cpus()[0]?.model?.trim() || "CPU";
  return new MemoryEmbeddingNodeReplica({
    nodeId: input.nodeId,
    coordinatorUrl: input.coordinatorUrl,
    session: input.session,
    choose: (failedBackends) => selectMemoryEmbeddingExecution({ platform: process.platform, arch: process.arch,
      accelerator: input.accelerator, cpuName, failedBackends }),
    artifacts: input.artifacts,
    budget: { maxCacheBytes: async () => (await input.config()).limits.maxDiskMiB * 1024 * 1024, cacheBytes: input.cacheBytes },
    launch: pythonReplicaLauncher({ pythonExecutable: input.pythonExecutable, pythonPath: input.pythonPath,
      workspace: input.workspace, windowsJobBrokerExecutable: input.windowsJobBrokerExecutable }),
    state: async () => {
      const [config, control] = await Promise.all([input.config(), input.control()]);
      return {
        contributionEnabled: control.contributionEnabled && input.contributionEnabled(),
        draining: control.draining,
        policyRejection: input.policyRejection(config.policy, MEMORY_EMBEDDING_MODEL, new Date()),
        limits: config.limits,
        offeredVramMiB: config.limits.maxVramMiB > 0 ? Math.min(config.limits.maxVramMiB, input.detectedVramMiB || config.limits.maxVramMiB) : input.detectedVramMiB,
        nodeRssMiB: process.memoryUsage().rss / (1024 * 1024),
        activeStages: input.activeStages(),
      };
    },
    ...(input.logger ? { logger: input.logger } : {}),
  });
}
