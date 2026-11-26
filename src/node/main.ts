import { dirname, join, resolve } from "node:path";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { readFileSync } from "node:fs";
import { loadWorkerConfig } from "../core/config.js";
import { WorkerAgent } from "../worker/agent.js";
import {
  createNativeNodeRuntime,
  headlessEnvironmentFromNodeConfiguration,
} from "../worker/headless-runtime.js";
import { NodeConfigurationStore } from "./config-store.js";
import { MycelliosNodeServiceHost } from "./service-host.js";
import { buildNodeDiagnosticSnapshot, writeNodeDiagnosticSnapshot } from "./diagnostics.js";
import {
  LinuxSystemdCredentialStore,
  MacOsKeychainSecretStore,
  NodeIdentityStore,
  WindowsDpapiSecretStore,
  type ProtectedSecretStore,
} from "./identity-store.js";
import { breachedLimit, createNodeResourceObserver, NodeResourceGovernor } from "./resource-governor.js";
import { assertNodeOsIsolation } from "./os-isolation.js";
import { NodeControlStateStore } from "./control-state.js";
import { NodeCommandExecutor } from "./command-executor.js";
import { runNodeCommandClient } from "./command-client.js";
import { NodeCommandApplicator } from "./command-applicator.js";
import { NODE_MANAGED_COMPONENT_IDS, NodeComponentLifecycle, resolveNodePythonProduct } from "./component-lifecycle.js";
import { acquireComponentInUseLease, readComponentInstallState, type ComponentInUseLease } from "../update/component-update-manager.js";
import { effectiveComponentUpdates } from "./update-trust.js";
import { bootstrapVersion, NODE_BOOTSTRAP_ROOT_ENV } from "./node-app-launch.js";
import type { NodeUpdateObservation } from "../contracts/node-control.js";
import { resolveNodeSourceRevision } from "./build-identity.js";
import { NodeReconciliationStateStore } from "./reconciliation-state.js";
import { MYCELLIOS_RUNTIME_ABI } from "../update/runtime-compatibility.js";
import { NodeUninstallScheduler } from "./uninstall-helper.js";
import { NodeEnrollmentBootstrap } from "./enrollment-bootstrap.js";
import { activateNativeNodeAccelerator, prepareNativeNodeAccelerator } from "./native-accelerator.js";
import { DEFAULT_NODE_WORK_POLICY, evaluateNodeWorkPolicy } from "../contracts/node-work-policy.js";
import { probeRuntimePerformanceProfile } from "../performance/runtime-profile-probe.js";
import { probeLlamaCppEngineRuntimeProfile } from "../worker/llama-cpp-engine-probe.js";
import { createNodeMemoryEmbeddingReplica, trackStageActivity, type MemoryEmbeddingNodeReplica } from "./memory-embedding-replica.js";
import { MemoryEmbeddingArtifactStore } from "./memory-embedding-artifact.js";
import { measureCacheDiskBytes } from "./cache-disk-usage.js";
import { seedOnlyExecutor, startNodeArtifactSeed, type NodeArtifactSeed } from "./artifact-seed-node.js";

const configPath = argument("--config") ?? defaultNodeConfigurationPath();
const allowLegacyMigration = process.argv.includes("--confirm-legacy-migration");
const store = new NodeConfigurationStore(configPath, { allowLegacyMigration });
const loaded = await store.load();
const config = loaded.config;
if (loaded.migrated) await store.save(config);
const version = packageVersion();
const runtimeMetadata = readNativeRuntimeBuildMetadata(resolve(import.meta.dirname, "../.."));
const sourceRevision = await resolveNodeSourceRevision();
let environment = headlessEnvironmentFromNodeConfiguration(config, version);
// The bundled supervisor names its install root; a component never supplies its
// own trust anchor or bootstrap version (specs/node-runtime-auto-update).
const supervisedBootstrapRoot = process.env[NODE_BOOTSTRAP_ROOT_ENV]?.trim() || null;
const bootstrapRoot = supervisedBootstrapRoot ?? resolve(import.meta.dirname, "../..");
const nodeAppSource: NodeUpdateObservation["nodeApp"] = supervisedBootstrapRoot
  && resolve(import.meta.dirname, "../..") !== resolve(supervisedBootstrapRoot) ? "component" : "bundled";
const componentUpdates = await effectiveComponentUpdates(config, bootstrapRoot).catch((error: unknown) => {
  console.warn(`node_component_trust_unavailable:${error instanceof Error ? error.message : "unknown"}`);
  return undefined;
});
const lifecycleConfig = componentUpdates ? { ...config, componentUpdates } : config;
const updateWorkIdle = () => (agent?.activeWorkCount ?? 0) === 0;
const componentLifecycle = componentUpdates
  ? new NodeComponentLifecycle(
    lifecycleConfig,
    supervisedBootstrapRoot ? await bootstrapVersion(supervisedBootstrapRoot) : version,
    updateWorkIdle,
    // Activation proceeds only while no lease or runtime operation is active.
    async () => updateWorkIdle() ? async () => undefined : null,
    fetch,
    undefined,
    undefined,
    // Only the bundled supervisor can launch and roll back a node-app root.
    supervisedBootstrapRoot ? NODE_MANAGED_COMPONENT_IDS : ["python-product"],
  )
  : null;
let pendingComponentActivation = componentLifecycle
  ? await componentLifecycle.pendingActivationIsCurrent()
  : false;
if (componentLifecycle && !pendingComponentActivation && await componentLifecycle.pendingActivation()) {
  await componentLifecycle.markActivationHealthy();
}
const host = new MycelliosNodeServiceHost(join(dirname(configPath), "state"));
const controlStore = new NodeControlStateStore(join(host.stateDirectory, "control.json"));
await host.acquire(config.revision);
await assertNodeOsIsolation(config);
const controlState = await controlStore.load();

let agent: WorkerAgent | null = null;
let supervisorStopRequested = false;
let agentStarted = false;
const stopForSupervisor = () => {
  supervisorStopRequested = true;
  if (agentStarted) void agent?.stop();
};
process.on("message", (message: unknown) => {
  if (typeof message === "object" && message !== null && "type" in message
    && message.type === "mycellios-node-stop") stopForSupervisor();
});
process.once("disconnect", stopForSupervisor);
let governor: NodeResourceGovernor | null = null;
let artifactSeed: NodeArtifactSeed | undefined;
let commandClientAbort: AbortController | null = null;
let commandClient: Promise<void> | null = null;
let failure: unknown = null;
let lastIncident: { code: string; occurredAt: string } | null = null;
let componentInUseLease: ComponentInUseLease | null = null;
let memoryReplica: MemoryEmbeddingNodeReplica | null = null;
try {
  const activePythonProduct = await resolveNodePythonProduct(lifecycleConfig);
  if (activePythonProduct && componentLifecycle) {
    componentInUseLease = await acquireComponentInUseLease(componentLifecycle.storageRoot, ["python-product"]);
    environment.pythonPath = componentInUseLease.roots["python-product"]!;
  }
  // Seed transfers (specs/artifact-seed-nodes). A seed-only node never probes
  // or launches the Python runtime; it only verifies and serves stored blobs.
  artifactSeed = await startNodeArtifactSeed(config);
  const seedOnly = artifactSeed.seedOnly;
  const seedPeer = artifactSeed.peer;
  if (!seedOnly) environment.artifactSeedEndpoint = () => seedPeer.requesterEndpoint();
  const accelerator = seedOnly || config.runtime.executionBackend === "cpu" ? undefined : await prepareNativeNodeAccelerator({
    configPath,
    pythonProductPath: environment.pythonPath,
    installRoot: dirname(dirname(config.runtime.pythonExecutable)),
    allowProvisioning: false,
  });
  if (accelerator) environment = activateNativeNodeAccelerator(environment, accelerator);
  const runtime: Omit<Awaited<ReturnType<typeof createNativeNodeRuntime>>, "physicalProbe" | "acceleration"> & {
    physicalProbe?: Awaited<ReturnType<typeof createNativeNodeRuntime>>["physicalProbe"];
  } = seedOnly ? { executor: seedOnlyExecutor(config) } : await createNativeNodeRuntime(environment);
  if (config.runtime.transport === "relay-only") runtime.executor.directTransport = { enabled: false };
  // Distributed stages have priority: the memory embedding replica yields before one prepares or starts.
  const stageActivity = trackStageActivity(runtime.executor.launchAgent, async () => { await memoryReplica?.yieldToStage(); });
  runtime.executor.launchAgent = stageActivity.agent;
  const device = runtime.verifiedGpuRuntime ? runtime.physicalProbe?.devices[0] : undefined;
  const detectedVramMiB = device
    ? Math.floor(Math.min(device.totalMemoryBytes, device.runtimeTotalMemoryBytes) / (1024 * 1024))
    : 0;
  const offeredMemoryMiB = device
    ? Math.min(detectedVramMiB, config.limits.maxVramMiB || detectedVramMiB)
    : Math.max(512, Math.floor(config.limits.maxRamMiB / 2));
  const workerConfig = loadWorkerConfig(environment.configPath);
  // Operator memory embeddings start here only on demand from this node's owner (specs/memory-embedding-qwen06).
  memoryReplica = seedOnly ? null : createNodeMemoryEmbeddingReplica({
    nodeId: config.nodeId, coordinatorUrl: environment.coordinatorUrl, cachePath: config.runtime.cachePath,
    workspace: join(host.stateDirectory, "memory-embedding-replica"), pythonExecutable: environment.pythonExecutable,
    pythonPath: environment.pythonPath, windowsJobBrokerExecutable: environment.windowsJobBrokerExecutable,
    accelerator, detectedVramMiB, session: () => agent?.nodeControlSession ?? null,
    config: async () => (await store.load()).config, control: async () => await controlStore.load(),
    contributionEnabled: () => agent?.isContributionEnabled ?? false,
    policyRejection: (policy, model, at) => evaluateNodeWorkPolicy(policy ?? DEFAULT_NODE_WORK_POLICY, model, at),
    activeStages: stageActivity.active, cacheBytes: async () => await measureCacheDiskBytes(config.runtime.cachePath),
    artifacts: new MemoryEmbeddingArtifactStore(join(config.runtime.cachePath, "memory-embedding")),
    logger: { info: (message) => console.log(message), warn: (message) => console.warn(message) },
  });
  const admissionSigner = await new NodeIdentityStore(
    config.coordinator.identityPath,
    platformSecretStore(),
    { allowLegacyMigration },
  ).loadOrCreate(config.nodeId);
  const enrollmentBootstrap = new NodeEnrollmentBootstrap(
    argument("--enrollment-file") ?? join(dirname(configPath), "enrollment.json"),
    config.coordinator.url,
  );
  agent = new WorkerAgent({
    ...workerConfig,
    capacityScope: "host",
    offeredVramMb: offeredMemoryMiB,
    limits: {
      ...workerConfig.limits,
      maxConcurrency: Math.min(workerConfig.limits.maxConcurrency, config.limits.maxConcurrency),
    },
  }, {
    coordinatorUrl: environment.coordinatorUrl,
    offeredHostMemoryBytes: () => config.limits.maxRamMiB * 1024 * 1024,
    artifactSeed: seedPeer,
    identity: { kind: "device", id: config.nodeId },
    admissionSigner,
    beforeSignedAdmission: (input) => enrollmentBootstrap.redeem(input),
    reconnect: true,
    advertiseDeployment: false,
    nativeReplica: memoryReplica ?? undefined,
    agentVersion: version,
    ...(runtimeMetadata.buildIdentity ? { buildIdentity: runtimeMetadata.buildIdentity } : {}),
    ...(runtime.verifiedGpuRuntime ? { verifiedGpuRuntime: runtime.verifiedGpuRuntime } : {}),
    ...(runtime.preferredHardwareGpu ? { preferredHardwareGpu: runtime.preferredHardwareGpu } : {}),
    ...(device && runtime.preferredHardwareGpu ? { hardwareCapacityOverride: {
      id: `physical-${device.index}`,
      vendor: runtime.preferredHardwareGpu.vendor,
      model: device.name,
      physicalVramMb: runtime.verifiedGpuRuntime?.backend === "directml" && runtime.preferredHardwareGpu.vendor === "intel" ? 0 : detectedVramMiB,
      ...(runtime.verifiedGpuRuntime?.backend === "directml" && runtime.preferredHardwareGpu.vendor === "intel" ? { sharedMemoryMb: detectedVramMiB, unifiedMemory: true } : {}),
    } } : {}),
    distributedExecutor: runtime.executor,
    // A seed-only node claims no runtime performance; its probes would start Python.
    ...(seedOnly ? {} : { runtimePerformanceProfileProbe: () => probeRuntimePerformanceProfile({
      pythonExecutable: environment.pythonExecutable,
      pythonPath: [environment.pythonPath],
      backend: runtime.verifiedGpuRuntime?.backend ?? "cpu",
      device: runtime.verifiedGpuRuntime && accelerator ? accelerator.launchDevice : "cpu",
      precision: runtime.verifiedGpuRuntime && accelerator ? accelerator.precision : "float32",
      ...(runtime.verifiedGpuRuntime ? { expectedDeviceName: runtime.verifiedGpuRuntime.deviceName } : {}),
      cwd: process.cwd(),
      env: { HF_HOME: environment.cachePath },
    }),
    // Native nodes qualify for the llama.cpp engine; it needs no Torch device.
    engineRuntimeProfileProbe: async (challenge) => challenge.probeKind === "llama-cpp-gguf-v1"
      ? await probeLlamaCppEngineRuntimeProfile(challenge, {
        pythonExecutable: environment.pythonExecutable,
        pythonPath: [environment.pythonPath],
        cacheDirectory: config.runtime.cachePath,
        cwd: process.cwd(),
        env: { HF_HOME: environment.cachePath },
      })
      : undefined }),
    contributionControl: {
      initialEnabled: controlState.contributionEnabled && !controlState.draining,
      onRemoteChange: async (enabled) => { await controlStore.setContributionEnabled(enabled); },
    },
    workAdmissionPolicy: (model, at) => evaluateNodeWorkPolicy(config.policy ?? DEFAULT_NODE_WORK_POLICY, model, at),
  });
  const resourceObserver = createNodeResourceObserver(config.runtime.cachePath);
  const snapshotResourceObserver = createNodeResourceObserver(config.runtime.cachePath);
  governor = new NodeResourceGovernor(
    config.limits,
    resourceObserver,
    async (code) => {
      failure = new Error(code);
      lastIncident = { code, occurredAt: new Date().toISOString() };
      await host.writeHealth("failed", config.revision, code);
      await controlStore.setContributionEnabled(false);
      await agent?.setContributionEnabled(false).catch(() => undefined);
      await agent?.stop();
    },
  );
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void agent?.stop());
  }
  const running = agent.start();
  agentStarted = true;
  if (supervisorStopRequested) void agent.stop();
  await waitUntil(() => agent?.isReady === true, running, 60_000);
  const uninstall = config.uninstall
    ? new NodeUninstallScheduler(config.uninstall.manifestPath, join(host.stateDirectory, "uninstall-requests"))
    : undefined;
  const commandApplicator = new NodeCommandApplicator(agent, controlStore, store, config, componentLifecycle ?? undefined, uninstall);
  if (controlState.draining) await commandApplicator.restoreDrain();
  await host.writeHealth("ready", config.revision);
  // A seed-only node has no physical runtime probe to describe.
  if (runtime.physicalProbe) {
    await writeNodeDiagnosticSnapshot(
      join(host.stateDirectory, "diagnostics.json"),
      buildNodeDiagnosticSnapshot({
        config,
        version,
        state: "ready",
        physicalProbe: runtime.physicalProbe,
      }),
    );
  }
  snapshotResourceObserver.resetCpuBaseline();
  governor.start();
  memoryReplica?.start();
  if (pendingComponentActivation && componentLifecycle) {
    await componentLifecycle.markActivationHealthy();
    pendingComponentActivation = false;
    await controlStore.setDraining(false);
    await commandApplicator.reconcileContribution(true, false);
  }
  const controlSession = agent.nodeControlSession;
  if (controlSession) {
    commandClientAbort = new AbortController();
    const commandExecutor = new NodeCommandExecutor(
      join(host.stateDirectory, `commands-generation-${controlSession.generation}.json`),
      config.nodeId,
      controlSession.generation,
    );
    const reconciliationState = new NodeReconciliationStateStore(
      join(host.stateDirectory, "reconciliation.json"),
      config.nodeId,
    );
    let restartAfterReconciliation = false;
    commandClient = runNodeCommandClient({
      coordinatorUrl: environment.coordinatorUrl,
      nodeId: config.nodeId,
      session: () => agent?.nodeControlSession ?? null,
      executor: commandExecutor,
      apply: async (application) => commandApplicator.apply(application),
      signal: commandClientAbort.signal,
      reconciliation: {
        state: reconciliationState,
        snapshot: async (cursor, session) => {
          const [currentControl, currentConfig, journal, resourceObservation] = await Promise.all([
            controlStore.load(),
            store.load(),
            commandExecutor.inspect(),
            snapshotResourceObserver().catch(() => null),
          ]);
          const resourceViolation = resourceObservation ? breachedLimit(currentConfig.config.limits, resourceObservation) : "node_resource_probe_failed";
          const incident = lastIncident ?? (resourceViolation ? { code: resourceViolation, occurredAt: new Date().toISOString() } : null);
          return {
            schema: "mycellios-node-snapshot/1",
            nodeId: config.nodeId,
            generation: session.generation,
            cursor,
            observedAt: new Date().toISOString(),
            state: incident ? "degraded" : agent?.isReady ? "ready" : "reconnecting",
            contributionEnabled: currentControl.contributionEnabled,
            draining: currentControl.draining,
            updateChannel: currentConfig.config.updateChannel,
            limits: currentConfig.config.limits,
            policy: currentConfig.config.policy ?? DEFAULT_NODE_WORK_POLICY,
            activeCommandIds: journal.records.filter(({ state }) => state === "applying").map(({ commandId }) => commandId),
            build: { version, sourceRevision },
            runtime: { ready: agent?.isReady === true, abi: MYCELLIOS_RUNTIME_ABI, backend: runtime.verifiedGpuRuntime?.backend ?? "cpu",
              uninstallAvailable: config.uninstall !== undefined },
            ...(await updateObservation(currentConfig.config.updateChannel)),
            diagnostics: {
              capturedAt: new Date().toISOString(),
              configRevision: currentConfig.config.revision,
              capacity: {
                acceleratorCount: runtime.physicalProbe?.devices.length ?? 0,
                primaryAccelerator: device ? { name: device.name, totalMemoryMiB: detectedVramMiB,
                  offeredMemoryMiB: Math.min(detectedVramMiB, currentConfig.config.limits.maxVramMiB || detectedVramMiB) } : null,
              },
              resources: resourceObservation ? { ...resourceObservation, healthy: resourceViolation === null, violation: resourceViolation } : null,
              incident,
            },
          };
        },
        onReconciled: async ({ desiredState, acknowledgedCommandIds }) => {
          if (uninstall && await uninstall.armAcknowledged(new Set(acknowledgedCommandIds)) > 0) {
            await agent?.stop();
            return;
          }
          const currentControl = await controlStore.load();
          if (desiredState.drain !== currentControl.draining) await commandApplicator.reconcileDrain(desiredState.drain);
          await commandApplicator.reconcileContribution(desiredState.contributionEnabled, desiredState.drain);
          const current = await store.load();
          const limitsChanged = JSON.stringify(current.config.limits) !== JSON.stringify(desiredState.limits);
          const policyChanged = JSON.stringify(current.config.policy) !== JSON.stringify(desiredState.policy);
          if (limitsChanged || policyChanged || current.config.updateChannel !== desiredState.updateChannel) {
            await store.save({
              ...current.config,
              revision: current.config.revision + 1,
              limits: desiredState.limits,
              policy: desiredState.policy ?? DEFAULT_NODE_WORK_POLICY,
              updateChannel: desiredState.updateChannel,
            });
            restartAfterReconciliation = true;
          }
        },
        onSnapshotAcknowledged: async () => {
          lastIncident = null;
          if (restartAfterReconciliation) await agent?.stop();
        },
      },
      onError: (error) => {
        const code = safeIncidentCode(error instanceof Error ? error.message : "node_command_client_error");
        lastIncident = { code, occurredAt: new Date().toISOString() };
        void host.writeHealth("ready", config.revision, code).catch(() => undefined);
      },
      onAcknowledged: async (command, result) => {
        if (result.state === "applied" && (commandApplicator.takeRestartAfterAck(command.id) || await commandApplicator.armStopAfterAck(command.id))) {
          await agent?.stop();
        }
      },
    });
  }
  await running;
} catch (error) {
  failure = error;
  if (pendingComponentActivation && componentLifecycle) {
    try {
      await componentLifecycle.rollbackFailedActivation();
      pendingComponentActivation = false;
    } catch (rollbackError) {
      failure = new AggregateError([error, rollbackError], "node_component_activation_and_rollback_failed");
    }
  }
  throw failure;
} finally {
  commandClientAbort?.abort();
  await commandClient?.catch(() => undefined);
  governor?.stop();
  await artifactSeed?.stop().catch(() => undefined);
  await memoryReplica?.stop().catch(() => undefined);
  await agent?.stop().catch(() => undefined);
  await componentInUseLease?.release().catch(() => undefined);
  try {
    await host.release(
      config.revision,
      failure ? "failed" : "stopped",
      failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
    );
  } finally {
    // The supervisor owns an IPC channel. Disconnect after shutdown so a
    // completed child cannot stay alive and prevent the supervisor restart.
    if (process.connected) process.disconnect();
  }
}

async function updateObservation(channel: "dev" | "stable"): Promise<{ updates?: NodeUpdateObservation }> {
  const platform = process.platform;
  const arch = process.arch;
  if ((platform !== "win32" && platform !== "linux" && platform !== "darwin") || (arch !== "x64" && arch !== "arm64")) return {};
  let activeManifestId: `sha256:${string}` | null = null;
  if (componentLifecycle) {
    const state = await readComponentInstallState(componentLifecycle.storageRoot).catch(() => null);
    activeManifestId = (state?.channels[channel]?.manifestId as `sha256:${string}` | undefined) ?? null;
  }
  return { updates: {
    // Automatic updates need the signed trust anchor and the supervising bootstrap.
    capable: componentLifecycle !== null && supervisedBootstrapRoot !== null
      && (componentUpdates?.pinnedKeys[channel].length ?? 0) > 0,
    channel, platform, arch, activeManifestId, nodeApp: nodeAppSource,
  } };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function defaultNodeConfigurationPath(): string {
  if (process.platform === "win32") {
    const root = process.env.PROGRAMDATA;
    if (!root) throw new Error("mycellios_node_programdata_is_missing");
    return join(root, "mycellios", "node.json");
  }
  if (process.platform === "darwin") return "/Library/Application Support/mycellios/node.json";
  return "/etc/mycellios/node.json";
}

async function waitUntil(
  predicate: () => boolean,
  running: Promise<void>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("mycellios_node_ready_timeout");
    await Promise.race([
      running.then(() => { throw new Error("mycellios_node_stopped_before_ready"); }),
      new Promise<void>((resolve) => setTimeout(resolve, 100)),
    ]);
  }
}

function packageVersion(): string {
  const document = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof document.version !== "string" || !document.version.trim()) {
    throw new Error("mycellios_node_package_version_is_invalid");
  }
  return document.version;
}

function platformSecretStore(): ProtectedSecretStore {
  if (process.platform === "linux") return new LinuxSystemdCredentialStore(
    join(dirname(config.coordinator.identityPath), "protected"),
  );
  if (process.platform === "darwin") return new MacOsKeychainSecretStore();
  if (process.platform === "win32") {
    const root = process.env.PROGRAMDATA;
    if (!root) throw new Error("mycellios_node_programdata_is_missing");
    return new WindowsDpapiSecretStore(join(root, "mycellios", "protected-identity"));
  }
  throw new Error(`mycellios_node_protected_identity_backend_is_unsupported:${process.platform}`);
}

function safeIncidentCode(value: string): string {
  const code = value.match(/^[a-zA-Z0-9_.:-]{1,120}/)?.[0];
  if (!code || /(authorization|cookie|credential|password|secret|token|api[-_]?key)/i.test(code) || /[A-Za-z0-9_-]{32,}/.test(code)) {
    return "unclassified_error";
  }
  return code;
}
