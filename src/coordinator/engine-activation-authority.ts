import { z } from "zod";
import {
  engineCertificationSchema,
  engineCertificationIdentity,
  engineFamilyDescriptorSchema,
} from "../contracts/engine-family.js";
import {
  ENGINE_RUNTIME_ACTIVATION_PLAN_SCHEMA,
  engineRuntimeActivationPlanSchema,
  type EngineRuntimeActivationPlan,
} from "../contracts/engine-runtime-activation.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import type { AutoDistributionRunResult } from "../distribution/auto-distribute.js";
import type { StoredWorker } from "../storage/store.js";

export const ENGINE_ACTIVATION_AUTHORITY_SCHEMA =
  "mycellios-engine-activation-authority/1" as const;

export const engineActivationAuthoritySchema = z.object({
  schema: z.literal(ENGINE_ACTIVATION_AUTHORITY_SCHEMA),
  descriptor: engineFamilyDescriptorSchema,
  certification: engineCertificationSchema,
  draftCompatibility: z.object({
    tokenizerDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    vocabularyDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }).strict().optional(),
  // A quantized GGUF the certified engine runs. Nodes fetch the tensor manifest
  // from `tensorManifestUrl`, verify its id and then fetch only their stage's
  // tensors from `url` (python/distributed_runtime/native_gguf_remote.py).
  artifact: z.object({
    format: z.literal("gguf"),
    url: z.string().url().max(2_048).refine((value) => value.startsWith("https://"), "gguf_artifact_url_must_use_https"),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().positive().safe(),
    tensorManifestUrl: z.string().url().max(2_048)
      .refine((value) => value.startsWith("https://"), "gguf_tensor_manifest_url_must_use_https"),
    tensorManifestId: z.string().regex(/^[0-9a-f]{64}$/),
    // The executor every stage of this artifact runs (native-gguf-source.ts).
    executor: z.enum(["torch", "llama-cpp"]),
  }).strict().optional(),
  probe: z.object({
    kind: z.enum(["qwen3-dense-v1", "llama-cpp-gguf-v1"]),
    quantization: z.string().trim().min(1).max(64),
    attentionHeads: z.number().int().positive().max(100_000),
    kvHeads: z.number().int().positive().max(100_000),
    headDim: z.number().int().positive().max(100_000),
    referenceDecodeMsPerToken: z.number().positive().finite().max(1_000_000_000),
    referencePrefillMsPerToken: z.number().positive().finite().max(1_000_000_000),
    minimumSamples: z.number().int().min(7).max(100_000),
  }).strict(),
}).strict().superRefine((authority, context) => {
  const descriptorDigest = sha256CanonicalEvidence(authority.descriptor);
  if (
    authority.certification.descriptorDigest !== descriptorDigest
    || authority.certification.artifactManifestDigest
      !== authority.descriptor.model.manifestDigest
  ) {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_certification_binding_is_invalid",
      path: ["certification"],
    });
  }
  if (
    authority.certification.certificationId
      !== engineCertificationIdentity(authority.certification)
  ) {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_certification_identity_mismatch",
      path: ["certification", "certificationId"],
    });
  }
  // The certification already binds descriptor.model.manifestDigest; for a
  // GGUF artifact that digest is the tensor manifest, so the certified engine
  // can only ever run the exact tensors the manifest pins.
  if (
    authority.artifact
    && authority.descriptor.model.manifestDigest !== `sha256:${authority.artifact.tensorManifestId}`
  ) {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_artifact_is_not_certified",
      path: ["artifact", "tensorManifestId"],
    });
  }
  // A llama.cpp probe measures the pinned GGUF the route itself runs.
  if (authority.probe.kind === "llama-cpp-gguf-v1" && authority.artifact?.executor !== "llama-cpp") {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_llama_cpp_probe_requires_llama_cpp_artifact",
      path: ["probe", "kind"],
    });
  }
  if (authority.certification.status !== "certified") {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_is_not_certified",
      path: ["certification", "status"],
    });
  }
  if (
    authority.probe.attentionHeads % authority.probe.kvHeads !== 0
    || authority.probe.attentionHeads * authority.probe.headDim <= 0
  ) {
    context.addIssue({
      code: "custom",
      message: "engine_activation_authority_qwen_shape_is_invalid",
      path: ["probe"],
    });
  }
});

export type EngineActivationAuthority = z.infer<
  typeof engineActivationAuthoritySchema
>;

export function buildEngineRuntimeActivationPlans(
  authorityValue: unknown,
  modelId: string,
  activationId: string,
  routeReservationId: string,
  result: AutoDistributionRunResult,
  workers: readonly StoredWorker[],
  now = Date.now(),
): EngineRuntimeActivationPlan[] {
  const authority = engineActivationAuthoritySchema.parse(authorityValue);
  if (
    !Number.isFinite(now)
    || Date.parse(authority.certification.validFrom) > now
    || Date.parse(authority.certification.expiresAt) <= now
  ) throw new Error("engine_activation_authority_certification_is_not_current");
  const llamaCpp = authority.probe.kind === "llama-cpp-gguf-v1";
  // A GGUF route's weights are named by its tensor manifest, not by a Hub
  // snapshot: bind the route's source to the certified artifact instead.
  const modelBound = llamaCpp
    ? result.profile.source.format === "gguf"
      && result.profile.source.canonicalRevision === authority.descriptor.model.revision
      && result.launch.configuration.nativeGgufSource?.tensorManifestId === authority.artifact?.tensorManifestId
      && result.launch.configuration.nativeGgufSource?.executor === "llama-cpp"
    : authority.descriptor.model.revision === result.profile.source.snapshotCommit
      && authority.descriptor.model.manifestDigest === result.profile.source.artifactIdentity;
  if (
    !modelBound
    || authority.descriptor.model.modelId !== result.profile.source.model
    || result.manifest.hiddenSize
      !== authority.probe.attentionHeads * authority.probe.headDim
  ) throw new Error("engine_activation_authority_model_binding_is_invalid");

  const descriptorDigest = sha256CanonicalEvidence(authority.descriptor) as `sha256:${string}`;
  const workerByNode = new Map(workers.flatMap((worker) => {
    const nodeId = worker.capabilities.distributedExecutor?.nodeId;
    return nodeId ? [[nodeId, worker] as const] : [];
  }));
  const createdAt = new Date(now).toISOString();
  const routeManifestDigest = sha256CanonicalEvidence(result.manifest) as `sha256:${string}`;
  const canaryEvidenceId = sha256CanonicalEvidence({
    activationId,
    routeManifestDigest,
    canaryText: result.canaryText,
    canaryMetrics: result.canaryMetrics,
  }) as `sha256:${string}`;
  const plans: EngineRuntimeActivationPlan[] = [];
  for (const stage of result.manifest.plans.decode.stages) {
    for (const member of stage.members) {
      const worker = workerByNode.get(member.nodeId);
      const executor = worker?.capabilities.distributedExecutor;
      const performance = executor?.performanceEvidence;
      const physical = executor?.physicalIdentity;
      if (!worker || !executor || !performance || !physical) {
        throw new Error(`engine_activation_stage_evidence_is_missing:${member.nodeId}:${stage.index}`);
      }
      // llama.cpp offloads to any GPU through Vulkan and otherwise runs on the
      // CPU; the probe reports the backend it really used and must match.
      const backend = llamaCpp
        ? worker.capabilities.gpus.length > 0
          && authority.descriptor.targets.some((candidate) => candidate.backend === "vulkan") ? "vulkan" : "cpu"
        : performance.profile.backend;
      const contextTokens = result.request.workload.contextTokens;
      const target = authority.descriptor.targets.find((candidate) =>
        candidate.backend === backend
        && candidate.quantizations.includes(authority.probe.quantization)
        && candidate.context.minTokens <= contextTokens
        && candidate.context.maxTokens >= contextTokens
      );
      const certifiedTarget = authority.certification.targets.find((candidate) =>
        target
        && candidate.platform === target.platform
        && candidate.arch === target.arch
        && candidate.backend === target.backend
        && candidate.runtimeAbi === target.runtimeAbi
        && candidate.quantizations.includes(authority.probe.quantization)
      );
      if (!target || !certifiedTarget) {
        throw new Error(`engine_activation_certified_target_is_missing:${member.nodeId}`);
      }
      // A CPU stage is certified as the "cpu" class: llama.cpp picks its
      // instruction-set kernels at load and the self-test measures exactness.
      const hardwareClasses = backend === "cpu" && llamaCpp ? ["cpu"] : worker.capabilities.gpus.map((gpu) =>
        `${gpu.vendor}-${gpu.model}`.toLowerCase().replace(/[^a-z0-9._:-]+/g, "-")
          .replace(/^-+|-+$/g, "").slice(0, 256)
      );
      if (!hardwareClasses.some((hardwareClass) =>
        authority.certification.hardwareClasses.includes(hardwareClass)
      )) throw new Error(`engine_activation_hardware_is_not_certified:${member.nodeId}`);
      const layers = result.profile.model.layers.slice(stage.layerStart, stage.layerEnd);
      if (layers.length !== stage.layerEnd - stage.layerStart) {
        throw new Error("engine_activation_stage_layer_range_is_invalid");
      }
      const roles: Array<"head" | "middle" | "tail"> = [];
      if (stage.index === 0) roles.push("head");
      if (stage.index > 0 && stage.index < result.manifest.plans.decode.stages.length - 1) {
        roles.push("middle");
      }
      if (stage.index === result.manifest.plans.decode.stages.length - 1) roles.push("tail");
      plans.push(engineRuntimeActivationPlanSchema.parse({
        schema: ENGINE_RUNTIME_ACTIVATION_PLAN_SCHEMA,
        modelId,
        activationId,
        routeReservationId,
        workerId: worker.id,
        createdAt,
        evidence: { routeManifestDigest, canaryEvidenceId },
        request: {
          probeKind: authority.probe.kind,
          ...(llamaCpp && authority.artifact ? { gguf: {
            artifactUrl: authority.artifact.url,
            artifactSha256: authority.artifact.sha256,
            artifactSizeBytes: authority.artifact.sizeBytes,
            tensorManifestUrl: authority.artifact.tensorManifestUrl,
            tensorManifestId: authority.artifact.tensorManifestId,
            // The same coordinates the route's packages carry (native-gguf-model.ts).
            modelSource: result.profile.source.canonicalSource,
          } } : {}),
          descriptorDigest,
          certificationId: authority.certification.certificationId,
          artifactManifestDigest: authority.certification.artifactManifestDigest,
          modelId,
          modelRevision: authority.descriptor.model.revision,
          backend,
          runtimeAbi: target.runtimeAbi,
          quantization: authority.probe.quantization,
          contextTokens,
          expectedLayerStart: stage.layerStart,
          expectedLayerEnd: stage.layerEnd,
          expectedKvBytesPerToken: layers.reduce((sum, layer) => sum + layer.kvBytesPerToken, 0),
          expectedLayerWeightBytes: layers.reduce((sum, layer) => sum + layer.weightBytes, 0),
          referenceDecodeMsPerToken: authority.probe.referenceDecodeMsPerToken,
          referencePrefillMsPerToken: authority.probe.referencePrefillMsPerToken,
          hiddenSize: result.manifest.hiddenSize,
          attentionHeads: authority.probe.attentionHeads,
          kvHeads: authority.probe.kvHeads,
          headDim: authority.probe.headDim,
          requiredRoles: roles,
          minimumSamples: authority.probe.minimumSamples,
        },
      }));
    }
  }
  return plans;
}

export type EngineRuntimeActivationPlanRecord =
  | { readonly status: "recorded"; readonly plans: number }
  | { readonly status: "skipped"; readonly reason: string };

/**
 * Store the engine runtime challenges for a committed activation.
 *
 * The scheduler only challenges workers whose plan is stored for a committed
 * route, and profiles expire after a day, so without this record no profile is
 * ever issued or renewed. The route is already serving when this runs: when
 * its evidence cannot be bound to the certified target, the model's plans are
 * cleared and the reason returned, but the activation itself is not failed.
 */
export async function recordEngineRuntimeActivationPlans(input: {
  authority: unknown;
  modelId: string;
  routeReservationId: string | null;
  result: AutoDistributionRunResult;
  workers: readonly StoredWorker[];
  store: {
    replaceEngineRuntimeActivationPlans(
      modelId: string,
      activationId: string,
      values: readonly unknown[],
    ): Promise<unknown>;
    removeEngineRuntimeActivationPlans(modelId: string): Promise<unknown>;
  };
  now?: number;
}): Promise<EngineRuntimeActivationPlanRecord> {
  if (input.routeReservationId === null) {
    // Challenges are tied to a committed route reservation.
    (await input.store.removeEngineRuntimeActivationPlans(input.modelId));
    return { status: "skipped", reason: "engine_activation_route_reservation_is_missing" };
  }
  const activationId = input.result.launch.launchId;
  let plans: EngineRuntimeActivationPlan[];
  try {
    plans = buildEngineRuntimeActivationPlans(
      input.authority,
      input.modelId,
      activationId,
      input.routeReservationId,
      input.result,
      input.workers,
      input.now,
    );
  } catch (error) {
    (await input.store.removeEngineRuntimeActivationPlans(input.modelId));
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  }
  (await input.store.replaceEngineRuntimeActivationPlans(input.modelId, activationId, plans));
  return { status: "recorded", plans: plans.length };
}
