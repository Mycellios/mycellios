import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { chatCompletionRequestSchema } from "../contracts/schemas.js";
import { createNativeReplicaEvidence, type NativeReplicaEvidenceInput } from "../contracts/native-replica-evidence.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST, verifiedSpeechEnvelope } from "../contracts/speech.js";
import { sha256CanonicalEvidence, sha256Text } from "../core/json.js";
import type { ChatCompletionRequest, ModelDeployment } from "../contracts/types.js";
import type { MeshStore, StoredWorker } from "../storage/store.js";
import type { JobStreamEvent, MeshService } from "./mesh-service.js";

const EMBEDDING_MODEL = "mycellios-qwen3-embedding-4b";
const EMBEDDING_DIGEST = "sha256:a6e058f3339e6bbd2d41463c50ca9ff5ae35507cf62627233488cdef7e928297";
const TEXT = "Madrid is the capital of Spain.";
const SPEECH_TEXT = "Prueba de verificación de Mycellios.";
const bodySchema = z.object({ workerId: z.string().min(1).max(256), deploymentId: z.string().min(1).max(256) }).strict();
type Completed = Extract<JobStreamEvent, { type: "completed" }>;
interface Options {
  adminToken: string | undefined;
  networkToken: string | undefined;
  hub: { currentWorkerSessionId(workerId: string): string | null; setWorkerMaintenance(workerId: string, enabled: boolean): Promise<void> };
  store: Pick<MeshStore, "getWorker" | "updateWorkerHeartbeat">;
  service: Pick<MeshService, "submit" | "cancel">;
  attachReceipt(event: Completed, model: string, route: "replica"): Completed | Promise<Completed>;
}
function deny(code: string, statusCode = 409): never { throw Object.assign(new Error(code), { statusCode }); }
function matches(value: unknown, expected: string | undefined): boolean {
  if (typeof value !== "string" || !expected) return false;
  const a = Buffer.from(value), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function plan(deployment: ModelDeployment) {
  if (String(deployment.adapter) === "embedding" && deployment.model === EMBEDDING_MODEL && deployment.modelDigest === EMBEDDING_DIGEST) {
    return { kind: "embedding" as const, content: JSON.stringify({ schema: "mycellios-embeddings/1", input: [TEXT], dimensions: 32 }) };
  }
  if (deployment.adapter === "kokoro" && deployment.model === KOKORO_MODEL && deployment.modelDigest === KOKORO_WEIGHT_DIGEST) {
    return { kind: "speech" as const, content: SPEECH_TEXT };
  }
  return deny("native_replica_model_is_not_supported", 422);
}
/** Returned bytes are validated without representing audio or vector components as text tokens. */
export function verifyNativeQualificationResult(kind: "embedding" | "speech", text: string): void {
  if (Buffer.byteLength(text) > 1_500_000) deny("native_replica_response_too_large", 422);
  if (kind === "speech") {
    verifiedSpeechEnvelope(text, SPEECH_TEXT, { voice: "ef_dora", language: "es", speed: 1 });
    return;
  }
  const envelope = z.object({ schema: z.literal("mycellios-embeddings/1"), result: z.object({
    object: z.literal("list"), model: z.literal(EMBEDDING_MODEL),
    data: z.array(z.object({ object: z.literal("embedding"), index: z.literal(0),
      embedding: z.array(z.number().finite()).length(32) }).strict()).length(1),
    usage: z.object({ prompt_tokens: z.number().int().positive(), total_tokens: z.number().int().positive() }).strict(),
  }).strict() }).strict().parse(JSON.parse(text));
  const norm = Math.sqrt(envelope.result.data[0]!.embedding.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.002 || envelope.result.usage.prompt_tokens !== envelope.result.usage.total_tokens) deny("native_replica_vector_is_invalid", 422);
}

export function registerNativeReplicaQualifications(app: FastifyInstance, options: Options): void {
  let busy = false;
  app.post("/internal/v1/workers/:workerId/maintenance", { bodyLimit: 128 }, async (request) => {
    if (!matches(request.headers["x-mycellios-admin-token"], options.adminToken)
      || !matches(request.headers.authorization, options.networkToken ? `Bearer ${options.networkToken}` : undefined)) deny("native_replica_qualification_not_authorized", 403);
    const { workerId } = z.object({ workerId: z.string().min(1).max(256) }).parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).strict().parse(request.body);
    await options.hub.setWorkerMaintenance(workerId, enabled);
    return { data: { workerId, enabled } };
  });
  app.post("/internal/v1/native-replica-qualifications", { bodyLimit: 512 }, async (request) => {
    if (!matches(request.headers["x-mycellios-admin-token"], options.adminToken)
      || !matches(request.headers.authorization, options.networkToken ? `Bearer ${options.networkToken}` : undefined)) deny("native_replica_qualification_not_authorized", 403);
    const target = bodySchema.parse(request.body);
    if (busy) deny("native_replica_qualification_busy");
    busy = true;
    let activeJob: string | null = null;
    try {
      const issuedAt = Date.now(), challengeId = `native-${randomUUID()}`;
      const worker = await options.store.getWorker(target.workerId);
      const sessionId = options.hub.currentWorkerSessionId(target.workerId);
      const deployment = worker?.capabilities.deployments.find(d => d.deploymentId === target.deploymentId);
      if (!worker || worker.status !== "online" || !sessionId || !deployment?.activationId
        || !worker.identityId || !worker.capabilities.buildIdentity || deployment.maxConcurrency !== 1
        || deployment.execution?.deviceType !== "gpu" || deployment.execution.fallback
        || deployment.execution.stages?.length !== 1 || deployment.execution.stages[0]!.deviceType !== "gpu") deny("native_replica_is_not_eligible", 422);
      const selectedPlan = plan(deployment), physicalNodeId = deployment.execution.stages[0]!.nodeId;
      const samples: NativeReplicaEvidenceInput["samples"] = [];
      const current = async (): Promise<StoredWorker> => {
        const value = await options.store.getWorker(worker.id);
        const found = value?.capabilities.deployments.find(d => d.deploymentId === deployment.deploymentId);
        if (!value || value.status !== "online" || options.hub.currentWorkerSessionId(worker.id) !== sessionId
          || value.capabilities.buildIdentity?.sourceId !== worker.capabilities.buildIdentity!.sourceId
          || found?.model !== deployment.model || found.modelDigest !== deployment.modelDigest
          || found.activationId !== deployment.activationId
          || sha256CanonicalEvidence(found.execution) !== sha256CanonicalEvidence(deployment.execution)) deny("native_replica_identity_changed");
        return value;
      };
      for (let index = 0; index < 3; index++) {
        await current();
        if (Date.now() - issuedAt > 480_000) deny("native_replica_qualification_expired");
        const chat = chatCompletionRequestSchema.parse({ model: deployment.model,
          messages: [{ role: "user", content: selectedPlan.content }], max_tokens: 1, stream: false,
          deadline_ms: 120_000, workload_class: "benchmark", temperature: 0,
          ...(selectedPlan.kind === "speech" ? { voice: "ef_dora", language: "es", speed: 1 } : {}),
          privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: [worker.identityId] },
        }) as ChatCompletionRequest;
        const handle = await options.service.submit(chat, `${challengeId}-${index}`);
        activeJob = handle.jobId;
        let result: Completed | null = null;
        for await (const event of handle.events) {
          if (event.type === "accepted" && (event.route.routeClass !== "replica"
            || event.route.stages.length !== 1 || event.route.stages[0]!.workerId !== worker.id
            || event.route.stages[0]!.deploymentId !== deployment.deploymentId)) deny("native_replica_route_mismatch");
          if (event.type === "failed") deny("native_replica_inference_failed", 502);
          if (event.type === "completed") result = event;
        }
        if (!result) deny("native_replica_inference_incomplete", 502);
        const r = result.result, trace = r.networkTrace;
        if (r.metrics.outputTokens !== 0 || r.metrics.inputTokens < 1 || !trace
          || trace.selectedRoute.length !== 1 || trace.selectedRoute[0]!.workerId !== worker.id
          || trace.selectedRoute[0]!.deploymentId !== deployment.deploymentId
          || trace.stages.length !== 1 || trace.stages[0]!.nodeId !== physicalNodeId
          || trace.stages[0]!.deviceType !== "gpu" || trace.stages[0]!.modelDigest !== deployment.modelDigest) deny("native_replica_execution_evidence_is_invalid", 422);
        verifyNativeQualificationResult(selectedPlan.kind, r.text);
        const signed = await options.attachReceipt(result, deployment.model, "replica");
        if (!signed.result.executionReceiptId) deny("native_replica_receipt_is_missing");
        samples.push({ jobId: r.jobId, receiptId: signed.result.executionReceiptId,
          traceDigest: sha256CanonicalEvidence(trace), resultDigest: sha256Text(r.text),
          inputTokens: r.metrics.inputTokens, outputTokens: 0, completedAt: Date.now() });
        activeJob = null;
      }
      const latest = await current();
      const evidence = createNativeReplicaEvidence({ schema: "mycellios-native-replica-qualification/1",
        workerId: worker.id, sessionId, deploymentId: deployment.deploymentId, activationId: deployment.activationId,
        model: deployment.model, modelDigest: deployment.modelDigest, physicalNodeId,
        buildSourceId: worker.capabilities.buildIdentity!.sourceId, responseKind: selectedPlan.kind,
        challengeId, promptDigest: sha256Text(selectedPlan.content), issuedAt, observedAt: Date.now(), samples });
      const capabilities = structuredClone(latest.capabilities);
      capabilities.deployments = capabilities.deployments.map(d => d.deploymentId === deployment.deploymentId
        ? { ...d, verificationState: "verified", nativeReplicaEvidence: evidence } : d);
      await options.store.updateWorkerHeartbeat(worker.id, capabilities, latest.status);
      return { data: evidence };
    } finally {
      if (activeJob) await options.service.cancel(activeJob);
      busy = false;
    }
  });
}
