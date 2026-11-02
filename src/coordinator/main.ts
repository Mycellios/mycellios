import { QualifiedWarmRouteAuthority } from "./qualified-warm-route.js";
import { readFile, writeFile, rename } from "node:fs/promises";
import { activationCanaryRecord } from "./activation-canary-record.js";
import { isAbsolute, resolve } from "node:path";
import { loadCoordinatorConfig } from "../core/config.js";
import { parseAutoDistributionConfig } from "../distribution/auto-distribute.js";
import {
  buildConnectedExecutorActivationSnapshot,
  resolveConnectedExecutorAgent,
} from "./connected-executor-activation.js";
import {
  AutomaticModelActivationManager,
  DynamicModelActivationManager,
} from "./model-activation-manager.js";
import { createCoordinator } from "./server.js";
import { readNativeRuntimeBuildMetadata } from "../core/native-build-identity.js";
import { configureCoordinatorModelProfileRuntime } from "./model-profile-runtime.js";
import {
  buildEngineRuntimeActivationPlans,
  engineActivationAuthoritySchema,
} from "./engine-activation-authority.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import { NativeDraftStrategyCatalog } from "../distribution/draft-strategy-catalog.js";
import { readMeasuredActivationCatalog, buildMeasuredActivationCatalogEvidence } from "./measured-activation-catalog.js";

const runtimeRoot = resolve(import.meta.dirname, "../..");
const runtimeMetadata = readNativeRuntimeBuildMetadata(runtimeRoot);
const config = loadCoordinatorConfig();
const activationConfigPath = process.env.MYCELLIOS_AUTO_DISTRIBUTE_CONFIG?.trim();
const dynamicWorkerActivation = process.env.MYCELLIOS_DYNAMIC_WORKER_ACTIVATION?.trim() === "1";
const measuredCatalogPath = process.env.MYCELLIOS_MEASURED_ACTIVATION_CATALOG?.trim();
const measuredCatalogSha256 = process.env.MYCELLIOS_MEASURED_ACTIVATION_CATALOG_SHA256?.trim();
const calibrationCandidateId = process.env.MYCELLIOS_ACTIVATION_CALIBRATION_CANDIDATE?.trim();
if (calibrationCandidateId && !measuredCatalogPath) throw new Error("activation_calibration_requires_pinned_catalog");
if (measuredCatalogPath && !/^[a-f0-9]{64}$/.test(measuredCatalogSha256 ?? "")) throw new Error("measured_catalog_digest_required");
const engineAuthorityPath = process.env.MYCELLIOS_ENGINE_ACTIVATION_AUTHORITY?.trim();
const draftCatalogPath = process.env.MYCELLIOS_DRAFT_STRATEGY_CATALOG?.trim();
const draftKeyringPath = process.env.MYCELLIOS_DRAFT_STRATEGY_KEYRING?.trim();
const absoluteActivationConfigPath = activationConfigPath
  ? isAbsolute(activationConfigPath) ? activationConfigPath : resolve(process.cwd(), activationConfigPath)
  : undefined;
const storedActivationConfig = absoluteActivationConfigPath
  ? parseAutoDistributionConfig(JSON.parse(await readFile(absoluteActivationConfigPath, "utf8")) as unknown)
  : undefined;
const baseActivationConfig = storedActivationConfig
  ? configureCoordinatorModelProfileRuntime(storedActivationConfig, {
      runtimeRoot,
      environment: process.env,
    })
  : undefined;
const engineActivationAuthority = engineAuthorityPath
  ? engineActivationAuthoritySchema.parse(JSON.parse(await readFile(
      isAbsolute(engineAuthorityPath)
        ? engineAuthorityPath
        : resolve(process.cwd(), engineAuthorityPath),
      "utf8",
    )) as unknown)
  : undefined;
if (Boolean(draftCatalogPath) !== Boolean(draftKeyringPath)) {
  throw new Error("draft_strategy_catalog_and_keyring_must_be_configured_together");
}
if ((draftCatalogPath || draftKeyringPath) && (
  !engineActivationAuthority
  || !engineActivationAuthority.draftCompatibility
  || !baseActivationConfig
  || !dynamicWorkerActivation
)) {
  throw new Error("draft_strategy_catalog_requires_complete_engine_activation_authority");
}
const draftStrategyCatalog = draftCatalogPath && draftKeyringPath
  ? new NativeDraftStrategyCatalog(
      JSON.parse(await readFile(
        isAbsolute(draftCatalogPath) ? draftCatalogPath : resolve(process.cwd(), draftCatalogPath),
        "utf8",
      )) as unknown,
      JSON.parse(await readFile(
        isAbsolute(draftKeyringPath) ? draftKeyringPath : resolve(process.cwd(), draftKeyringPath),
        "utf8",
      )) as unknown,
    )
  : undefined;
const draftCompatibility = engineActivationAuthority?.draftCompatibility;
if (engineActivationAuthority && (!baseActivationConfig || !dynamicWorkerActivation)) {
  throw new Error("engine_activation_authority_requires_dynamic_worker_activation");
}
const activationManager = baseActivationConfig && !dynamicWorkerActivation
  ? new AutomaticModelActivationManager(
      baseActivationConfig,
      runtimeRoot,
      process.env,
    )
  : undefined;
const runtime = await createCoordinator(config, {
  logger: true,
  runtimeMetadata,
  engineRuntimeProfileReconciliation: engineActivationAuthority !== undefined,
  ...(activationManager ? { activationManager } : {}),
  ...(baseActivationConfig && dynamicWorkerActivation
    ? {
        activationManagerFactory: ({ store, hub, deploymentController }) => {
          const recovery = new QualifiedWarmRouteAuthority(store, hub);
          return new DynamicModelActivationManager({
          createRecoveryLease: async (modelId, context) => (await recovery.capture(modelId, context)),
          ...(calibrationCandidateId ? { calibrationCandidateId } : {}),
          ...(measuredCatalogPath ? { measuredCandidateEvidence: async (modelId, currentConfig, profile) => {
            if (calibrationCandidateId) {
              const path = resolve(process.cwd(), measuredCatalogPath + ".calibration-input.json");
              await writeFile(path + ".tmp", JSON.stringify({ modelId, config: currentConfig, profile }), { mode: 0o600 });
              await rename(path + ".tmp", path);
            }
            return buildMeasuredActivationCatalogEvidence(await readMeasuredActivationCatalog(
              resolve(process.cwd(), measuredCatalogPath), measuredCatalogSha256!), {
              modelId, config: currentConfig, profile, workers: (await store.listWorkers()),
              connectedWorkerIds: hub.connectedWorkerIds(), pythonExecutable: currentConfig.runtime.pythonExecutable,
            }); } } : {}),
          cwd: runtimeRoot,
          workerAgentVersion: runtimeMetadata.version,
          ...(runtimeMetadata.buildIdentity
            ? { workerBuildIdentity: runtimeMetadata.buildIdentity }
            : {}),
          snapshot: async () => buildConnectedExecutorActivationSnapshot(
            baseActivationConfig,
            (await store.listWorkers()),
            hub.connectedWorkerIds(),
            hub.runtimeLinkObservations(),
            engineActivationAuthority,
          ),
          resolveManagedAgent: async (nodeId, launch) => resolveConnectedExecutorAgent(
            (await store.listWorkers()),
            hub.connectedWorkerIds(),
            hub,
            nodeId,
            launch,
          ),
          ...(draftStrategyCatalog && engineActivationAuthority && draftCompatibility
            ? {
                resolveDraftStrategyAuthority: async (launch) => {
                  const rootNodeId = launch.launchOrder.find(
                    (process) => process.kind === "root-engine",
                  )?.anchor.memberId;
                  const worker = (await store.listWorkers()).find((candidate) =>
                    candidate.capabilities.distributedExecutor?.nodeId === rootNodeId
                  );
                  const backend = worker?.capabilities.distributedExecutor
                    ?.performanceEvidence?.profile.backend;
                  if (!worker || !backend) {
                    throw new Error("draft_strategy_root_physical_context_is_missing");
                  }
                  const availableVramBytes = worker.capabilities.gpus.reduce(
                    (sum, gpu) => sum + gpu.freeOfferedVramMb * 1024 * 1024,
                    0,
                  );
                  return draftStrategyCatalog.resolveForLaunch(launch, {
                    targetDescriptorDigest: sha256CanonicalEvidence(
                      engineActivationAuthority.descriptor,
                    ) as `sha256:${string}`,
                    tokenizerDigest: draftCompatibility.tokenizerDigest as `sha256:${string}`,
                    vocabularyDigest: draftCompatibility.vocabularyDigest as `sha256:${string}`,
                    backend,
                    availableRamBytes: launch.configuration.draftModel
                      ?.memoryReservationBytes ?? Number.MAX_SAFE_INTEGER,
                    availableVramBytes,
                    now: new Date(),
                  });
                },
              }
            : {}),
          loadProgress: async (modelId) => (await store.listActivationEvents(modelId)),
          onProgress: async (modelId, event) => {
            (await store.appendActivationEvent(modelId, event));
            if (event.phase === "running_canary") {
              const operation = (await deploymentController.activeOperationForModel(modelId));
              if (operation) (await deploymentController.markCanary(operation.id));
            }
          },
          onPlanPrepared: async (modelId, stages) => {
            const operation = (await deploymentController.activeOperationForModel(modelId));
            if (!operation) throw new Error(`deployment_operation_missing:${modelId}`);
            const reservation = (await deploymentController.prepareRoute(operation.id, stages));
            await recovery.prepare(modelId, stages);
            return { id: reservation.id, generation: reservation.generation };
          },
          onPlanHeartbeat: async (_modelId, reservationId) =>
            (await deploymentController.renewRoute(reservationId)),
          onActivated: async (modelId, reservationId, result) => {
            const canary = activationCanaryRecord(result);
            if (reservationId) {
              try {
                (await deploymentController.commitRoute(reservationId, canary));
              } catch (error) {
                (await store.removeEngineRuntimeActivationPlans(modelId));
                throw error;
              }
              return;
            }
            const operation = (await deploymentController.activeOperationForModel(modelId));
            if (operation) (await deploymentController.completeOperation(operation.id, "active", { canary }));
          },
          onStopped: async (modelId) => {
            recovery.forget(modelId);
            (await store.removeEngineRuntimeActivationPlans(modelId));
          },
        }); },
      }
    : {}),
});

await runtime.app.listen({ host: config.host, port: config.port });
runtime.app.log.info(
  `mycellios coordinator listening on http://${config.host}:${config.port}`,
);
if (baseActivationConfig) {
  runtime.app.log.info(
    `${dynamicWorkerActivation ? "dynamic worker" : "static"} model activation enabled with ${activationConfigPath}`,
  );
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void runtime.close().finally(() => process.exit(0));
  });
}
