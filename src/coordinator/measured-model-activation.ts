import { resolve } from "node:path";
import { isRouteAvailabilityRejection } from "./measured-route-eligibility.js";
import { denseComparableWorkload, type DenseStageLimits } from '../distribution/dense-workload-comparison.js';
import { denseCandidateFitsCurrentCapacity } from "./dense-candidate-capacity.js";
import { denseExecutableLaunchSha256 } from "../distribution/dense-execution-identity.js";
import { compileAutoDistribution, type AutoDistributionCompilation,
  type AutoDistributionConfig, type CompiledModelProfile } from "../distribution/auto-distribute.js";
import { selectMeasuredDenseLaunch } from "../distribution/dense-measured-launch.js";
import type { FleetResourceEvidence } from "../distribution/fleet-resource-roles.js";
import { applyMeasuredRuntimePolicy, normalizedMeasuredRuntimeConfiguration, type MeasuredRuntimePolicy } from "./measured-runtime-policy.js";

export interface MeasuredModelActivationEvidence {
  /** Server-owned authenticated observations and immutable complete request receipts. */
  document: unknown;
  candidates: ReadonlyMap<string, AutoDistributionCompilation>;
  pythonExecutable: string;
  /** Coordinator package root for the metadata-only selector. */
  pythonPath?: string;
  /** Server-owned service readiness and measured artifact-transfer demands. */
  resourceContributions?: FleetResourceEvidence;
  /** Only explicit operator-pinned alternatives may override the current default. */
  candidateThreadsPerStage?: ReadonlyMap<string, number>;
  candidateRuntimePolicies?: ReadonlyMap<string, MeasuredRuntimePolicy>;
}

/** Rebuild candidates against current configuration without requiring a default route. */
export async function compileMeasuredModelActivation(
  config: AutoDistributionConfig, profile: CompiledModelProfile,
  evidence: MeasuredModelActivationEvidence | null, cwd: string, environment: NodeJS.ProcessEnv,
): Promise<AutoDistributionCompilation> {
  const current = rebuildCurrentActivationCandidates(config, profile, evidence);
  return selectMeasuredModelActivation(current.candidates.values().next().value!, current,
    cwd, environment, { minimum: config.distribution.minimumStages,
      maximum: Math.min(config.distribution.maximumStages, config.nodes.length, 8) });
}

/** Explicit operator calibration: same admission checks, without claiming measured speed. */
export function compilePinnedActivationCalibration(
  config: AutoDistributionConfig, profile: CompiledModelProfile,
  evidence: MeasuredModelActivationEvidence, candidateId: string,
): AutoDistributionCompilation {
  const current = rebuildCurrentActivationCandidates(config, profile, evidence);
  const candidate = current.candidates.get(candidateId);
  if (!candidate) throw new Error("activation_calibration_candidate_unavailable");
  return structuredClone(candidate);
}

function rebuildCurrentActivationCandidates(
  config: AutoDistributionConfig, profile: CompiledModelProfile,
  evidence: MeasuredModelActivationEvidence | null,
): MeasuredModelActivationEvidence {
  if (!evidence || evidence.candidates.size === 0) throw new Error("measured_activation_no_qualified_route");
  const candidates = new Map<string, AutoDistributionCompilation>();
  const available = new Set(config.nodes.map(node => node.id));
  const unavailable = new Set<string>();
  let unavailableRouteError: unknown;
  const capacities = new Map(config.nodes.map(node => [node.id, {
    hostBytes: (node.hostMemoryMiB ?? 0) * 1024 * 1024,
    graphicsBytes: Math.max(0, node.memoryMiB - node.reserveMiB) * 1024 * 1024,
  }]));
  for (const [id, candidate] of evidence.candidates) {
    if (!candidate.request.phasePlans) throw new Error("measured_activation_explicit_plan_required");
    if (candidate.launch.launchOrder.some(process =>
      process.members.some(member => !available.has(member.nodeId)))
        || Object.values(candidate.manifest.plans).some(plan => plan.stages.some(stage =>
          stage.members.some(member => !available.has(member.nodeId))))) {
      unavailable.add(id);
      continue;
    }
    if (!denseCandidateFitsCurrentCapacity(candidate.request.phasePlans, capacities)) {
      unavailable.add(id); continue;
    }
    const threads = evidence.candidateThreadsPerStage?.get(id);
    const threadConfig = threads === undefined ? config : { ...config, runtime: {
      ...config.runtime, threadsPerStage: threads } };
    const candidateConfig = applyMeasuredRuntimePolicy(threadConfig, evidence.candidateRuntimePolicies?.get(id));
    let rebuilt;
    try {
      rebuilt = compileAutoDistribution(candidateConfig, profile, candidate.request.phasePlans);
    } catch (error) {
      if (!isRouteAvailabilityRejection(error)) throw error;
      unavailableRouteError = error;
      unavailable.add(id);
      continue;
    }
    if (JSON.stringify(candidate.profile) !== JSON.stringify(rebuilt.profile)
        || denseExecutableLaunchSha256(candidate.launch) !== denseExecutableLaunchSha256(rebuilt.launch)) {
      throw new Error("measured_activation_candidate_not_current");
    }
    const rootHost = rebuilt.manifest.plans.decode.stages[0]!.anchor.endpoint.host;
    if (rootHost !== config.runtime.apiAdvertiseHost || rootHost !== config.runtime.returnEndpoint.host) {
      throw new Error("measured_activation_root_endpoint_not_current");
    }
    candidates.set(id, rebuilt);
  }
  if (candidates.size === 0) throw unavailableRouteError ?? new Error("measured_activation_no_qualified_route");
  let document = evidence.document;
  if (unavailable.size > 0) {
    if (!document || typeof document !== "object" || Array.isArray(document)
        || !Array.isArray((document as Record<string, unknown>).candidates)) {
      throw new Error("measured_activation_document_invalid");
    }
    const value = structuredClone(document) as Record<string, unknown>;
    value.candidates = (value.candidates as unknown[]).filter(row =>
      !row || typeof row !== "object" || !unavailable.has((row as { id: string }).id));
    document = value;
  }
  return { ...evidence, document, candidates };
}

export async function selectMeasuredModelActivation(
  base: AutoDistributionCompilation,
  evidence: MeasuredModelActivationEvidence,
  cwd: string,
  environment: NodeJS.ProcessEnv,
  stageLimits?: DenseStageLimits,
): Promise<AutoDistributionCompilation> {
  for (const [id, candidate] of evidence.candidates) {
    if (stageLimits) {
      for (const value of [base, candidate]) {
        for (const plan of Object.values(value.manifest.plans)) {
          denseComparableWorkload(value.request.workload, plan.stages.length, stageLimits);
        }
      }
    }
    const threads = evidence.candidateThreadsPerStage?.get(id);
    if (threads !== undefined && (!Number.isInteger(threads) || threads < 1 || threads > 1_024
        || candidate.launch.configuration.threadsPerStage !== threads)) {
      throw new Error("measured_activation_thread_policy_mismatch");
    }
    const threadConfiguration = threads === undefined ? candidate.launch.configuration : {
      ...candidate.launch.configuration, threadsPerStage: base.launch.configuration.threadsPerStage,
    };
    const normalizedConfiguration = normalizedMeasuredRuntimeConfiguration(threadConfiguration, base.launch.configuration, evidence.candidateRuntimePolicies?.get(id));
    if (JSON.stringify(candidate.profile) !== JSON.stringify(base.profile)
        || JSON.stringify(candidate.launch.modelIdentity) !== JSON.stringify(base.launch.modelIdentity)
        || JSON.stringify(candidate.launch.runtimeModel) !== JSON.stringify(base.launch.runtimeModel)
        || JSON.stringify(stageLimits ? denseComparableWorkload(candidate.request.workload, candidate.manifest.plans.decode.stages.length, stageLimits) : candidate.request.workload)
          !== JSON.stringify(stageLimits ? denseComparableWorkload(base.request.workload, base.manifest.plans.decode.stages.length, stageLimits) : base.request.workload)
        || JSON.stringify(candidate.request.topology) !== JSON.stringify(base.request.topology)
        || candidate.request.modelRevision !== base.request.modelRevision
        || JSON.stringify(normalizedConfiguration) !== JSON.stringify(base.launch.configuration)) {
      throw new Error("measured_activation_model_identity_mismatch");
    }
  }
  const launches = new Map([...evidence.candidates].map(([id, candidate]) => [id, candidate.launch]));
  const result = await selectMeasuredDenseLaunch(evidence.document,
    { pythonExecutable: evidence.pythonExecutable, cwd, environment: evidence.pythonPath
      ? { ...environment, PYTHONPATH: resolve(cwd, evidence.pythonPath) } : environment }, launches, evidence.resourceContributions);
  if (result.launch === null || result.selection.selected === null) {
    throw new Error("measured_activation_no_qualified_route");
  }
  const candidate = evidence.candidates.get(result.selection.selected.candidateId)!;
  const root = (value: AutoDistributionCompilation) =>
    value.launch.launchOrder.find((entry) => entry.kind === "root-engine")?.anchor;
  if (JSON.stringify(root(candidate)) !== JSON.stringify(root(base))) {
    throw new Error("measured_activation_root_identity_mismatch");
  }
  if (JSON.stringify(candidate.manifest) !== JSON.stringify(result.launch.sourceManifest)) {
    throw new Error("measured_activation_manifest_mismatch");
  }
  return { ...structuredClone(candidate), launch: result.launch,
    ...(result.resourceRoles === null ? {} : { resourceRoles: result.resourceRoles }) };
}


