import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerNativeReplicaQualifications, verifyNativeQualificationResult } from "../src/coordinator/native-replica-qualification.js";
import { nativeReplicaEvidenceSchema } from "../src/contracts/native-replica-evidence.js";
import { stripWorkerDeclaredEvidence, mergeCurrentSessionEvidence } from "../src/coordinator/evidence-authority.js";
import { verifiedContributionCanary } from "../src/economy/deployment-contribution-canary.js";
import { KOKORO_MODEL, KOKORO_WEIGHT_DIGEST } from "../src/contracts/speech.js";
import type { StoredWorker } from "../src/storage/store.js";
import type { JobStreamEvent, MeshService } from "../src/coordinator/mesh-service.js";
import { speechReply } from "./kokoro-fixture.js";
import { deploymentSchema } from "../src/contracts/schemas.js";

it("accepts a pinned speech activation without granting text-canary authority", () => {
  const declaration = { deploymentId: "speech-1", model: KOKORO_MODEL, modelDigest: KOKORO_WEIGHT_DIGEST,
    activationId: "physical-reservation-1", adapter: "kokoro", mode: "replica", peakVramMb: 1536,
    contextLimit: 8192, maxConcurrency: 1, freeSlots: 1, tokensPerSecond: 5, ttftMs: 1000, dataLocality: "local" };
  expect(deploymentSchema.safeParse(declaration).success).toBe(true);
  expect(deploymentSchema.safeParse({ ...declaration, modelDigest: `sha256:${"0".repeat(64)}` }).success).toBe(false);
  expect(deploymentSchema.safeParse({ ...declaration, verificationState: "verified" }).success).toBe(false);
  expect(deploymentSchema.safeParse({ ...declaration, throughputSource: "measured" }).success).toBe(false);
});

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function fixture(mode: "normal" | "session-change" | "wrong-route" | "failed" | "fake-output" = "normal") {
  const app = Fastify(); apps.push(app);
  let session = "session-1", writes = 0, next = 0;
  const worker = { id: "worker-1", status: "online", identityId: "physical-cell", capabilities: {
    buildIdentity: { schema: "mycellios-native-build-provenance/1", version: "0.2.77", sourceId: sha("1") },
    gpus: [], deployments: [{ deploymentId: "deployment-1", activationId: "activation-1", model: KOKORO_MODEL,
      modelDigest: KOKORO_WEIGHT_DIGEST, adapter: "kokoro", mode: "replica", maxConcurrency: 1, freeSlots: 1,
      execution: { deviceType: "gpu", backend: "cuda", fallback: false, stages: [{ nodeId: "node-1", deviceType: "gpu" }] } }],
  } } as unknown as StoredWorker;
  const submit = vi.fn((request: unknown, sessionId?: string) => {
    const index = ++next;
    const events = (async function* (): AsyncIterable<JobStreamEvent> {
      if (mode === "failed") { yield { type: "failed", code: "runtime_failed", message: "failed" }; return; }
      if (mode === "session-change") session = "different-session";
      yield { type: "completed", result: {
        jobId: `job-${index}`, text: speechReply("Prueba de verificación de Mycellios.", 100, { voice: "ef_dora", language: "es", speed: 1 }).content,
        metrics: { inputTokens: 2, outputTokens: mode === "fake-output" ? 1 : 0, ttftMs: 1, activeMs: 10 },
        networkTrace: { selectedRoute: [{ workerId: mode === "wrong-route" ? "other-worker" : worker.id, deploymentId: "deployment-1" }],
          stages: [{ nodeId: "node-1", deviceType: "gpu", modelDigest: KOKORO_WEIGHT_DIGEST }] },
      } } as unknown as JobStreamEvent;
    })();
    return { jobId: `job-${index}`, sessionId: sessionId ?? "", events };
  });
  const cancel = vi.fn(() => true);
  registerNativeReplicaQualifications(app, {
    adminToken: "operator-admin", networkToken: "operator-network",
    hub: { currentWorkerSessionId: () => session, setWorkerMaintenance: async () => {} },
    store: { getWorker: () => worker, updateWorkerHeartbeat: (_id, capabilities) => { writes++; worker.capabilities = capabilities; } },
    service: { submit: submit as MeshService["submit"], cancel },
    attachReceipt: event => ({ ...event, result: { ...event.result, executionReceiptId: sha(String(next)) } }),
  });
  const call = () => app.inject({ method: "POST", url: "/internal/v1/native-replica-qualifications",
    headers: { authorization: "Bearer operator-network", "x-mycellios-admin-token": "operator-admin" },
    payload: { workerId: worker.id, deploymentId: "deployment-1" } });
  return { app, worker, submit, cancel, call, writes: () => writes };
}

describe("native non-text qualification authority", () => {
  it("requires both operator credentials and never accepts supplied proof", async () => {
    const f = fixture();
    const r = await f.app.inject({ method: "POST", url: "/internal/v1/native-replica-qualifications",
      headers: { authorization: "Bearer operator-network" }, payload: { workerId: "worker-1", deploymentId: "deployment-1" } });
    expect(r.statusCode).toBe(403); expect(f.submit).not.toHaveBeenCalled(); expect(f.writes()).toBe(0);
  });
  it("records three leased completed jobs with zero generated tokens and exact session binding", async () => {
    const f = fixture(); const r = await f.call(); expect(r.statusCode, r.body).toBe(200);
    const evidence = nativeReplicaEvidenceSchema.parse(r.json().data);
    expect(evidence.samples.map(s => s.outputTokens)).toEqual([0, 0, 0]);
    expect(f.submit).toHaveBeenCalledTimes(3); expect(f.writes()).toBe(1);
    expect(f.submit.mock.calls[0]![0]).toMatchObject({ privacy: { pinned_identity_ids: ["physical-cell"] } });
    const d = f.worker.capabilities.deployments[0]!;
    expect(verifiedContributionCanary({ owner: f.worker, deployment: d, modelDigest: d.modelDigest,
      physicalNodeId: "node-1", observedUntil: evidence.observedAt, currentSessionId: "session-1" })).toBe(evidence.evidenceId);
    expect(() => verifiedContributionCanary({ owner: f.worker, deployment: d, modelDigest: d.modelDigest,
      physicalNodeId: "node-1", observedUntil: evidence.observedAt, currentSessionId: "different-session" })).toThrow("binding_is_invalid");
  });
  it.each(["session-change", "wrong-route", "failed", "fake-output"] as const)("never publishes evidence after %s", async mode => {
    const f = fixture(mode); const r = await f.call(); expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(f.writes()).toBe(0); expect(f.worker.capabilities.deployments[0]!.nativeReplicaEvidence).toBeUndefined();
  });
  it("strips worker-declared evidence, preserves the coordinator's current-session evidence and revokes changed activations", async () => {
    const f = fixture(); expect((await f.call()).statusCode).toBe(200);
    const current = structuredClone(f.worker.capabilities);
    expect(stripWorkerDeclaredEvidence(current).deployments[0]!.nativeReplicaEvidence).toBeUndefined();
    expect(mergeCurrentSessionEvidence(f.worker.id, "session-1", current, current).deployments[0]!.nativeReplicaEvidence).toBeDefined();
    expect(mergeCurrentSessionEvidence(f.worker.id, "new-session", current, current).deployments[0]!.nativeReplicaEvidence).toBeUndefined();
    const changed = structuredClone(current); changed.deployments[0]!.activationId = "new-activation";
    expect(mergeCurrentSessionEvidence(f.worker.id, "session-1", changed, current).deployments[0]!.nativeReplicaEvidence).toBeUndefined();
    const tampered = structuredClone(current.deployments[0]!.nativeReplicaEvidence!); tampered.samples[0]!.resultDigest = sha("9");
    expect(nativeReplicaEvidenceSchema.safeParse(tampered).success).toBe(false);
  });
  it("rejects malformed vector and audio bytes", () => {
    const value = { schema: "mycellios-embeddings/1", result: { object: "list", model: "mycellios-qwen3-embedding-4b",
      data: [{ object: "embedding", index: 0, embedding: [1, ...Array(31).fill(0)] }], usage: { prompt_tokens: 8, total_tokens: 8 } } };
    expect(() => verifyNativeQualificationResult("embedding", JSON.stringify(value))).not.toThrow();
    value.result.data[0]!.embedding.fill(0);
    expect(() => verifyNativeQualificationResult("embedding", JSON.stringify(value))).toThrow("vector_is_invalid");
    expect(() => verifyNativeQualificationResult("speech", "{}" )).toThrow();
  });
});
