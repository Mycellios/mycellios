import { isRouteAvailabilityRejection } from "./measured-route-eligibility.js";
import { stagePackageBindingsSchema } from '../distribution/stage-package-bindings.js';
import { denseExecutableLaunchSha256 } from "../distribution/dense-execution-identity.js";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { nativeBuildIdentitySchema } from "../contracts/build-identity.js";
import { hostMemoryObservationSchema, isFreshHostMemory } from "../contracts/host-memory.js";
import { denseCandidateFitsCurrentCapacity } from "./dense-candidate-capacity.js";
import { compileAutoDistribution, type AutoDistributionConfig,
  type CompiledModelProfile } from "../distribution/auto-distribute.js";
import type { RuntimePlanRequest } from "../distribution/runtime-manifest.js";
import type { StoredWorker } from "../storage/store.js";
import type { MeasuredModelActivationEvidence } from "./measured-model-activation.js";
import { plannerScalesFromCoordinatorEvidence } from "../performance/runtime-profile.js";
import { applyMeasuredRuntimePolicy } from "./measured-runtime-policy.js";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const catalogSchema = z.object({
  schema: z.enum(["mycellios-measured-activation-catalog/1", "mycellios-measured-activation-catalog/2"]),
  models: z.array(z.object({
    modelId: z.string().min(1), profileSha256: digest,
    bindings: z.array(z.object({
      nodeId: z.string().min(1), workerId: z.string().min(1),
      buildIdentity: nativeBuildIdentitySchema, backend: z.string().min(1),
      gpuId: z.string().min(1).nullable(),
    }).strict()).min(1),
    candidates: z.array(z.object({
      id: z.string().min(1), launchSha256: digest,
      nodeIds: z.array(z.string().min(1)).min(1).max(64),
      phasePlans: z.record(z.string(), z.unknown()),
      /** Optional operator-pinned CPU dispatch policy, sealed into launchSha256. */
      threadsPerStage: z.number().int().min(1).max(1_024).optional(),
      stagePackageIdentities: stagePackageBindingsSchema.optional(),
      tcpWriteChunkBytes: z.number().int().min(64).max(1_048_576).optional(),
      independentParallelStartup: z.boolean().optional(),
      rootStartupDelayMs: z.number().int().nonnegative().max(60_000).optional(),
      prefillInflightChunks: z.number().int().min(1).max(64).optional(),
    }).strict()).min(1),
    selection: z.object({
      candidates: z.array(z.unknown()), context: z.string().min(1),
      layer_count: z.number().int().positive(), generated_tokens: z.number().int().positive(),
      reference_output_sha256: digest,
    }).strict(),
  }).strict()).max(128),
}).strict();

const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 8 * 1024 * 1024;

/** Local operator-pinned calibration only; public clients cannot submit catalogs. */
export async function readMeasuredActivationCatalog(path: string, expectedSha256: string): Promise<unknown> {
  if (!digest.safeParse(expectedSha256).success) throw new Error("measured_catalog_digest_required");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = await handle.read(buffer, bytes, buffer.length - bytes, bytes);
      if (read.bytesRead === 0) break;
      bytes += read.bytesRead;
    }
    if (bytes > MAX_BYTES) throw new Error("measured_catalog_too_large");
    const payload = buffer.subarray(0, bytes);
    if (sha256(payload) !== expectedSha256) throw new Error("measured_catalog_digest_mismatch");
    return JSON.parse(payload.toString("utf8")) as unknown;
  } finally { await handle.close(); }
}

/** Compile against live topology and replace every saved availability observation. */
export function buildMeasuredActivationCatalogEvidence(
  document: unknown, input: {
    modelId: string; config: AutoDistributionConfig; profile: CompiledModelProfile;
    workers: readonly StoredWorker[]; connectedWorkerIds: ReadonlySet<string>;
    pythonExecutable: string; now?: number;
  },
): MeasuredModelActivationEvidence | null {
  const catalog = catalogSchema.parse(document);
  if (new Set(catalog.models.map(row => row.modelId)).size !== catalog.models.length) {
    throw new Error("measured_catalog_duplicate_model");
  }
  const row = catalog.models.find(value => value.modelId === input.modelId);
  if (!row) return null;
  if (sha256(JSON.stringify(input.profile)) !== row.profileSha256
      || row.selection.layer_count !== input.profile.model.layers.length) {
    throw new Error("measured_catalog_model_mismatch");
  }
  if (new Set(row.bindings.map(binding => binding.nodeId)).size !== row.bindings.length
      || new Set(row.bindings.map(binding => binding.workerId)).size !== row.bindings.length
      || new Set(row.candidates.map(candidate => candidate.id)).size !== row.candidates.length) {
    throw new Error("measured_catalog_duplicate_identity");
  }
  const now = input.now ?? Date.now() / 1000;
  if (!Number.isFinite(now)) throw new Error("measured_catalog_clock_invalid");
  const devices = row.bindings.map(binding => {
    const worker = input.workers.find(value => value.id === binding.workerId);
    const executor = worker?.capabilities.distributedExecutor;
    const memory = hostMemoryObservationSchema.safeParse(worker?.capabilities.hostMemory);
    const build = nativeBuildIdentitySchema.safeParse(worker?.capabilities.buildIdentity);
    let profiled = false;
    if (worker && executor?.performanceEvidence) {
      try {
        plannerScalesFromCoordinatorEvidence(executor.performanceEvidence,
          { workerId: worker.id, nodeId: binding.nodeId });
        profiled = executor.performanceEvidence.profile.backend === binding.backend;
      } catch { /* An unverified client claim is not current calibration context. */ }
    }
    const gpu = worker?.capabilities.gpus.find(value => value.id === binding.gpuId);
    const current = !!worker && worker.status === "online" && input.connectedWorkerIds.has(worker.id)
      && executor?.nodeId === binding.nodeId && profiled && memory.success && build.success
      && build.data.sourceId === binding.buildIdentity.sourceId
      && build.data.version === binding.buildIdentity.version
      && now - worker.lastSeenAt / 1000 >= 0 && now - worker.lastSeenAt / 1000 <= 120
      && isFreshHostMemory(memory.data, now)
      && (binding.backend === "cpu" ? executor.cpuEligible === true && binding.gpuId === null : !!gpu);
    return { id: binding.nodeId, backend: binding.backend, connected: current, observedAt: now,
      hostBudgetBytes: current && memory.success ? memory.data.availableBytes : 0,
      vramBudgetBytes: current && gpu ? gpu.freeOfferedVramMb * 1024 * 1024 : 0 };
  });
  const candidates = new Map();
  const available = new Set(input.config.nodes.map(node => node.id));
  const connected = new Set(devices.filter(device => device.connected).map(device => device.id));
  const capacities = new Map(devices.filter(device => device.connected).map(device => {
    const node = input.config.nodes.find(node => node.id === device.id);
    return [device.id, { hostBytes: Math.min(device.hostBudgetBytes, (node?.hostMemoryMiB ?? 0) * 1024 * 1024),
      graphicsBytes: Math.min(device.vramBudgetBytes, Math.max(0, (node?.memoryMiB ?? 0) - (node?.reserveMiB ?? 0)) * 1024 * 1024) }];
  }));
  const unavailable = new Set<string>();
  let unavailableRouteError: unknown;
  for (const candidate of row.candidates) {
    if (new Set(candidate.nodeIds).size !== candidate.nodeIds.length) throw new Error("measured_catalog_duplicate_identity");
    if (candidate.nodeIds.some(id => !available.has(id) || !connected.has(id))) { unavailable.add(candidate.id); continue; }
    if (!denseCandidateFitsCurrentCapacity(candidate.phasePlans, capacities)) { unavailable.add(candidate.id); continue; }
    const threadConfig = candidate.threadsPerStage === undefined ? input.config : {
      ...input.config, runtime: { ...input.config.runtime, threadsPerStage: candidate.threadsPerStage },
    };
    const candidateConfig = applyMeasuredRuntimePolicy(threadConfig, candidate);
    let compilation;
    try {
      compilation = compileAutoDistribution(candidateConfig, input.profile,
        candidate.phasePlans as NonNullable<RuntimePlanRequest["phasePlans"]>);
    } catch (error) {
      if (!isRouteAvailabilityRejection(error)) throw error;
      unavailableRouteError = error;
      unavailable.add(candidate.id);
      continue;
    }
    const used = new Set(compilation.launch.launchOrder.flatMap(process => process.members.map(member => member.nodeId)));
    if (used.size !== candidate.nodeIds.length || candidate.nodeIds.some(id => !used.has(id))
        || (catalog.schema === "mycellios-measured-activation-catalog/2"
          ? denseExecutableLaunchSha256(compilation.launch) : sha256(JSON.stringify(compilation.launch))) !== candidate.launchSha256) {
      throw new Error("measured_catalog_launch_mismatch");
    }
    candidates.set(candidate.id, compilation);
  }
  if (candidates.size === 0 && unavailableRouteError) throw unavailableRouteError;
  return { candidates, pythonExecutable: input.pythonExecutable, pythonPath: input.config.runtime.pythonPath,
    candidateRuntimePolicies: new Map(row.candidates.filter(candidate => candidates.has(candidate.id))
      .map(candidate => [candidate.id, { stagePackageIdentities: candidate.stagePackageIdentities, tcpWriteChunkBytes: candidate.tcpWriteChunkBytes, independentParallelStartup: candidate.independentParallelStartup, rootStartupDelayMs: candidate.rootStartupDelayMs, prefillInflightChunks: candidate.prefillInflightChunks }])),
    candidateThreadsPerStage: new Map(row.candidates.filter(candidate =>
      candidate.threadsPerStage !== undefined && candidates.has(candidate.id))
      .map(candidate => [candidate.id, candidate.threadsPerStage!])),
    document: { ...structuredClone(row.selection),
      candidates: row.selection.candidates.filter(value => !value || typeof value !== "object"
        || !unavailable.has((value as { id: string }).id)), devices } };
}
