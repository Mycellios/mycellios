import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryEmbeddingAdapter } from "../src/adapters/memory-embedding.js";
import { createAdapter } from "../src/adapters/factory.js";
import { EmbeddingAdapter } from "../src/adapters/embedding.js";
import {
  MAX_MEMORY_EMBEDDING_RESPONSE_BYTES, MEMORY_EMBEDDING_CANARY_MIN_COSINE, MEMORY_EMBEDDING_DIGEST,
  MEMORY_EMBEDDING_DIMENSIONS, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_REVISION, MEMORY_EMBEDDING_SCHEMA,
  approvedMemoryEmbeddingExecution, memoryEmbeddingCanaryCosine, memoryEmbeddingCanaryReference,
  parseMemoryEmbeddingRequest, verifiedMemoryEmbeddingEnvelope,
} from "../src/contracts/memory-embedding.js";
import { EMBEDDING_DIGEST, EMBEDDING_MODEL } from "../src/contracts/embedding.js";
import { chatCompletionRequestSchema, deploymentSchema, workerConfigSchema } from "../src/contracts/schemas.js";
import type { ChatCompletionRequest, ModelDeployment, WorkerCapabilities } from "../src/contracts/types.js";
import { registerNativeReplicaQualifications, verifyNativeQualificationResult } from "../src/coordinator/native-replica-qualification.js";
import { MeshService, type JobStreamEvent } from "../src/coordinator/mesh-service.js";
import { replicaOutputByteLimit } from "../src/coordinator/speech-completion.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredWorker } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

/** Same value as EXPECTED_IDENTITY in python/tests/test_qwen06_embedding_service.py. */
const PINNED_IDENTITY = "sha256:7ced807793a552878c586b4fc420c5f9edef134abe30e4202b9f2022487cdd55";
const CUDA = { deviceType: "gpu", backend: "cuda", deviceName: "NVIDIA GeForce RTX 2060", precision: "float16", fallback: false,
  stages: [{ nodeId: "mrpucchi", stageIndex: 0, layerStart: 0, layerEnd: 28, deviceType: "gpu", backend: "cuda",
    deviceName: "NVIDIA GeForce RTX 2060", precision: "float16", fallback: false }] } as const satisfies ModelDeployment["execution"];
const withPrecision = (backend: string, precision: string) => ({ ...CUDA, backend, precision,
  stages: [{ ...CUDA.stages[0], backend, precision }] }) as unknown as ModelDeployment["execution"];
const unit = (axis = 0) => Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, i) => i === axis ? 1 : 0);
const envelope = (vectors: number[][], tokens = 7 * vectors.length) => JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, result: {
  object: "list", model: MEMORY_EMBEDDING_MODEL, revision: MEMORY_EMBEDDING_REVISION,
  data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
  usage: { prompt_tokens: tokens, total_tokens: tokens } } });
const chat = (content: unknown): ChatCompletionRequest => ({ model: MEMORY_EMBEDDING_MODEL,
  messages: [{ role: "user", content: typeof content === "string" ? content : JSON.stringify(content) }], max_tokens: 1 });

describe("memory embedding contract", () => {
  it("pins the artifact identity shared with the Python runtime", () => {
    expect(MEMORY_EMBEDDING_DIGEST).toBe(PINNED_IDENTITY);
    expect(MEMORY_EMBEDDING_DIGEST).not.toBe(EMBEDDING_DIGEST);
  });

  it("parses bounded document and query batches", () => {
    expect(parseMemoryEmbeddingRequest(chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] })).input_type).toBe("document");
    expect(parseMemoryEmbeddingRequest(chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"], input_type: "query" })).input_type).toBe("query");
    for (const bad of [{ schema: MEMORY_EMBEDDING_SCHEMA, input: [] }, { schema: MEMORY_EMBEDDING_SCHEMA, input: Array(65).fill("a") },
      { schema: MEMORY_EMBEDDING_SCHEMA, input: [" "] }, { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"], dimensions: 512 },
      { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"], input_type: "passage" }, { schema: "mycellios-embeddings/1", input: ["a"] }]) {
      expect(() => parseMemoryEmbeddingRequest(chat(bad))).toThrow();
    }
    expect(() => parseMemoryEmbeddingRequest({ ...chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] }), model: EMBEDDING_MODEL })).toThrow("memory_embedding_model_mismatch");
  });

  it("accepts only complete, ordered, unit-length 1024-dimensional batches", () => {
    const request = parseMemoryEmbeddingRequest(chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a", "b"] }));
    expect(verifiedMemoryEmbeddingEnvelope(envelope([unit(0), unit(1)]), request).result.data).toHaveLength(2);
    const zero = unit(0).map(() => 0);
    for (const bad of [envelope([unit(0)]), envelope([unit(0), zero]), envelope([unit(0), unit(1).slice(1)]),
      envelope([unit(0), unit(1)], 1), envelope([unit(0), unit(1).map((x) => x * 2)]),
      envelope([unit(0), unit(1)]).replace(MEMORY_EMBEDDING_REVISION, "0".repeat(40)),
      JSON.stringify({ ...JSON.parse(envelope([unit(0), unit(1)])), extra: true })]) {
      expect(() => verifiedMemoryEmbeddingEnvelope(bad, request)).toThrow();
    }
  });

  it("fits a full batch of real-sized vectors under the response limit", () => {
    const value = -1.2345678901234567e-5;
    const vector = Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, () => value);
    expect(Buffer.byteLength(envelope(Array(64).fill(vector)))).toBeLessThan(MAX_MEMORY_EMBEDDING_RESPONSE_BYTES);
    expect(MAX_MEMORY_EMBEDDING_RESPONSE_BYTES).toBeLessThan(2 * 1024 * 1024);
  });

  it("admits only measured GPU device/precision pairs", () => {
    expect(approvedMemoryEmbeddingExecution(CUDA)).toEqual({ backend: "cuda", precision: "float16" });
    expect(approvedMemoryEmbeddingExecution(withPrecision("directml", "float32"))).not.toBeNull();
    expect(approvedMemoryEmbeddingExecution(withPrecision("mps", "float16"))).not.toBeNull();
    expect(approvedMemoryEmbeddingExecution(withPrecision("directml", "float16"))).toBeNull();
    expect(approvedMemoryEmbeddingExecution(withPrecision("cuda", "bfloat16"))).toBeNull();
    expect(approvedMemoryEmbeddingExecution({ ...CUDA, fallback: true, fallbackReason: "cpu" })).toBeNull();
    expect(approvedMemoryEmbeddingExecution({ ...CUDA, stages: undefined })).toBeNull();
    expect(approvedMemoryEmbeddingExecution(undefined)).toBeNull();
  });

  it("gives memory embeddings their own deadline and output limit", () => {
    expect(chatCompletionRequestSchema.parse(chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] })).deadline_ms).toBe(300_000);
    expect(replicaOutputByteLimit({ adapter: "embedding", model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST } as ModelDeployment))
      .toBe(MAX_MEMORY_EMBEDDING_RESPONSE_BYTES);
  });
});

describe("memory embedding worker configuration and deployments", () => {
  const config = {
    region: "es-mad", capacityScope: "cell", offeredVramMb: 1024, limits: { maxConcurrency: 1 },
    adapter: { kind: "embedding", model: MEMORY_EMBEDDING_MODEL, baseUrl: "http://127.0.0.1:18497/" },
    deployment: { modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: "qwen06-cuda-mrpucchi-20261122", contextLimit: 524_288, execution: CUDA },
  };
  const deployment: ModelDeployment = { deploymentId: "dep-q06", model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST,
    activationId: "act-q06", adapter: "embedding", mode: "replica", peakVramMb: 1024, contextLimit: 524_288, maxConcurrency: 1,
    freeSlots: 1, tokensPerSecond: 5, ttftMs: 2000, dataLocality: "local", execution: CUDA };

  it("accepts the pinned replica and rejects drifted or unpinned ones", () => {
    expect(workerConfigSchema.safeParse(config).success).toBe(true);
    for (const bad of [
      { ...config, deployment: { ...config.deployment, modelDigest: EMBEDDING_DIGEST } },
      { ...config, deployment: { ...config.deployment, execution: withPrecision("directml", "float16") } },
      { ...config, deployment: { ...config.deployment, execution: undefined } },
      { ...config, limits: { maxConcurrency: 2 } },
      { ...config, adapter: { ...config.adapter, baseUrl: "http://100.102.221.91:18495/" } },
    ]) expect(workerConfigSchema.safeParse(bad).success).toBe(false);
    // The 4B replica keeps its own digest.
    expect(workerConfigSchema.safeParse({ ...config, adapter: { ...config.adapter, model: EMBEDDING_MODEL } }).success).toBe(false);
    expect(workerConfigSchema.safeParse({ ...config, adapter: { ...config.adapter, model: EMBEDDING_MODEL },
      deployment: { ...config.deployment, modelDigest: EMBEDDING_DIGEST } }).success).toBe(true);
  });

  it("validates advertised deployments the same way", () => {
    expect(deploymentSchema.safeParse(deployment).success).toBe(true);
    expect(deploymentSchema.safeParse({ ...deployment, maxConcurrency: 2, freeSlots: 2 }).success).toBe(false);
    expect(deploymentSchema.safeParse({ ...deployment, execution: withPrecision("directml", "float16") }).success).toBe(false);
    expect(deploymentSchema.safeParse({ ...deployment, modelDigest: EMBEDDING_DIGEST }).success).toBe(false);
    expect(deploymentSchema.safeParse({ ...deployment, verificationState: "verified" }).success).toBe(false);
  });

  it("builds the memory adapter for the 0.6B model and keeps the 4B adapter", () => {
    expect(createAdapter(workerConfigSchema.parse(config))).toBeInstanceOf(MemoryEmbeddingAdapter);
    expect(createAdapter(workerConfigSchema.parse({ ...config, adapter: { ...config.adapter, model: EMBEDDING_MODEL },
      deployment: { ...config.deployment, modelDigest: EMBEDDING_DIGEST } }))).toBeInstanceOf(EmbeddingAdapter);
  });
});

describe("MemoryEmbeddingAdapter against a loopback runtime", () => {
  let server: Server;
  let health: Record<string, unknown>;
  let lastBody: Record<string, unknown> | null;
  let reply: (body: Record<string, unknown>) => { status: number; text: string };
  const read = async (request: IncomingMessage) => { let raw = ""; for await (const chunk of request) raw += chunk; return raw; };
  const ACTIVATION = "act-q06";
  let baseUrl = "";
  beforeEach(async () => {
    health = { status: "ready", model: MEMORY_EMBEDDING_MODEL, upstream_model: "Qwen/Qwen3-Embedding-0.6B", revision: MEMORY_EMBEDDING_REVISION,
      artifact_identity: MEMORY_EMBEDDING_DIGEST, activation_id: ACTIVATION, runtime: "mycellios-memory-embedding/1",
      dimensions: 1024, max_inputs: 64, max_input_tokens: 8192, device: "cuda", dtype: "float16" };
    lastBody = null;
    reply = (body) => ({ status: 200, text: envelope((body.input as string[]).map((_, i) => unit(i))) });
    server = createServer(async (request, response) => {
      if (request.method === "GET" && request.url === "/health") { response.end(JSON.stringify(health)); return; }
      lastBody = JSON.parse(await read(request));
      const { status, text } = reply(lastBody!);
      response.writeHead(status, { "content-type": "application/json" }).end(text);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterEach(async () => { await new Promise((resolve) => server.close(resolve)); });
  const adapter = (execution: ModelDeployment["execution"] = CUDA) => new MemoryEmbeddingAdapter({ baseUrl, model: MEMORY_EMBEDDING_MODEL,
    modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: ACTIVATION, execution });
  const lease = () => ({ id: "lease-1", deadline: Date.now() + 60_000 });
  async function collect(target: MemoryEmbeddingAdapter, content: unknown) {
    let text = ""; let inputTokens = 0;
    for await (const chunk of target.generate({ jobId: "job-1", request: chat(content), lease: lease() }, new AbortController().signal)) {
      text += chunk.text; inputTokens = chunk.metrics?.inputTokens ?? inputTokens;
    }
    return { text, inputTokens };
  }

  it("is ready only for the pinned identity, this activation and the configured device", async () => {
    const target = adapter();
    await expect(target.probe()).resolves.toMatchObject({ models: [MEMORY_EMBEDDING_MODEL], embeddings: true });
    expect((await target.metrics()).loadedModels).toEqual([MEMORY_EMBEDDING_MODEL]);
    for (const change of [{ status: "waiting_reservation" }, { status: "cooling" }, { activation_id: "other" },
      { artifact_identity: EMBEDDING_DIGEST }, { dtype: "float32" }, { device: "directml" }, { extra: 1 }]) {
      const saved = health; health = { ...health, ...change };
      await expect(target.probe()).rejects.toThrow();
      health = saved;
    }
    expect(() => adapter(withPrecision("directml", "float16"))).toThrow("memory_embedding_execution_not_approved");
  });

  it("forwards the lease and input type and returns the verified envelope", async () => {
    const target = adapter();
    await target.probe();
    const { text, inputTokens } = await collect(target, { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a", "b"], input_type: "query" });
    expect(lastBody).toMatchObject({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["a", "b"], input_type: "query",
      lease: { jobId: "job-1", id: "lease-1", activationId: ACTIVATION } });
    expect(JSON.parse(text).result.data).toHaveLength(2);
    expect(inputTokens).toBe(14);
  });

  it("refuses runtime output that is not a valid vector batch", async () => {
    const target = adapter();
    await target.probe();
    reply = (body) => ({ status: 200, text: envelope((body.input as string[]).map(() => unit(0).map(() => 0))) });
    await expect(collect(target, { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] })).rejects.toThrow();
    reply = () => ({ status: 503, text: "{}" });
    await expect(collect(target, { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] })).rejects.toThrow();
    await expect(collect(adapter(), { schema: MEMORY_EMBEDDING_SCHEMA, input: ["a"] })).rejects.toThrow("memory_embedding_runtime_not_ready");
  });
});

describe("memory embedding native qualification", () => {
  const reference = () => Array.from(memoryEmbeddingCanaryReference());
  it("accepts the pinned canary vector and rejects drift", () => {
    expect(memoryEmbeddingCanaryCosine(reference())).toBeCloseTo(1, 6);
    expect(() => verifyNativeQualificationResult("memory-embedding", envelope([reference()], 12))).not.toThrow();
    // A slightly perturbed but still unit-length vector (cosine about 0.99) is drift.
    const drifted = reference().map((value, index) => value + (index % 2 ? 0.004 : -0.004));
    const norm = Math.sqrt(drifted.reduce((sum, x) => sum + x * x, 0));
    const normalized = drifted.map((x) => x / norm);
    expect(memoryEmbeddingCanaryCosine(normalized)).toBeLessThan(MEMORY_EMBEDDING_CANARY_MIN_COSINE);
    expect(() => verifyNativeQualificationResult("memory-embedding", envelope([normalized], 12))).toThrow("memory_embedding_canary_drift");
    expect(() => verifyNativeQualificationResult("memory-embedding", envelope([unit(3)], 12))).toThrow("memory_embedding_canary_drift");
    expect(() => verifyNativeQualificationResult("memory-embedding", envelope([reference(), reference()], 12))).toThrow("native_replica_vector_is_invalid");
  });

  const apps: FastifyInstance[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
  it("records three receipts as embedding evidence bound to the pinned query canary", async () => {
    const app = Fastify(); apps.push(app);
    const sha = (c: string) => `sha256:${c.repeat(64)}`;
    const worker = { id: "worker-q06", status: "online", identityId: "mrpucchi-cell", capabilities: {
      buildIdentity: { schema: "mycellios-native-build-provenance/1", version: "0.2.77", sourceId: sha("1") },
      gpus: [], deployments: [{ deploymentId: "dep-q06", activationId: "act-q06", model: MEMORY_EMBEDDING_MODEL,
        modelDigest: MEMORY_EMBEDDING_DIGEST, adapter: "embedding", mode: "replica", maxConcurrency: 1, freeSlots: 1, execution: CUDA }],
    } } as unknown as StoredWorker;
    let next = 0;
    const submit = vi.fn(async (request: ChatCompletionRequest) => {
      const index = ++next;
      expect(JSON.parse(request.messages[0]!.content)).toEqual({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["What is the capital of Spain?"], input_type: "query" });
      expect(request.privacy).toMatchObject({ boundary: "pinned-edges", pinned_identity_ids: ["mrpucchi-cell"] });
      const events = (async function* (): AsyncIterable<JobStreamEvent> {
        yield { type: "completed", result: { jobId: `job-${index}`, text: envelope([reference()], 12),
          metrics: { inputTokens: 12, outputTokens: 0, ttftMs: 1, activeMs: 10 },
          networkTrace: { selectedRoute: [{ workerId: worker.id, deploymentId: "dep-q06" }],
            stages: [{ nodeId: "mrpucchi", deviceType: "gpu", modelDigest: MEMORY_EMBEDDING_DIGEST }] } } } as unknown as JobStreamEvent;
      })();
      return { jobId: `job-${index}`, sessionId: "", events };
    });
    registerNativeReplicaQualifications(app, {
      adminToken: "operator-admin", networkToken: "operator-network",
      hub: { currentWorkerSessionId: () => "session-1", setWorkerMaintenance: async () => {} },
      store: { database: { transaction: async (action) => await action() }, getWorker: async () => worker,
        updateWorkerHeartbeat: async (_id, capabilities) => { worker.capabilities = capabilities; } },
      service: { submit: submit as unknown as MeshService["submit"], cancel: vi.fn(async () => true) },
      attachReceipt: (event) => ({ ...event, result: { ...event.result, executionReceiptId: sha(String(next)) } }),
    });
    const response = await app.inject({ method: "POST", url: "/internal/v1/native-replica-qualifications",
      headers: { authorization: "Bearer operator-network", "x-mycellios-admin-token": "operator-admin" },
      payload: { workerId: worker.id, deploymentId: "dep-q06" } });
    expect(response.statusCode).toBe(200);
    const evidence = response.json().data;
    expect(evidence).toMatchObject({ responseKind: "embedding", model: MEMORY_EMBEDDING_MODEL, physicalNodeId: "mrpucchi" });
    expect(evidence.samples).toHaveLength(3);
    expect(worker.capabilities.deployments[0]).toMatchObject({ verificationState: "verified" });
  });
});

class Hub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Array<{ workerId: string; type: string }> = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  send(workerId: string, type: string): boolean { this.sent.push({ workerId, type }); return this.isConnected(workerId); }
}

describe("memory embedding routing", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  beforeEach(async () => { database = await MeshDatabase.open(":memory:"); store = new MeshStore(database); });
  afterEach(async () => { await database.close(); });
  const SOURCE = `sha256:${"a".repeat(64)}`;
  async function replica(id: string, qualified: boolean): Promise<StoredWorker> {
    const worker = await addWorker(store, { id, model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, maxConcurrency: 1, contextLimit: 524_288 });
    const capabilities: WorkerCapabilities = structuredClone(worker.capabilities);
    capabilities.buildIdentity = { sourceId: SOURCE } as never;
    const base = capabilities.deployments[0]!;
    capabilities.deployments = [{ ...base, adapter: "embedding", activationId: `act-${id}`, execution: CUDA,
      ...(qualified ? { verificationState: "verified", nativeReplicaEvidence: { workerId: worker.id, deploymentId: base.deploymentId,
        model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: `act-${id}`, buildSourceId: SOURCE,
        observedAt: Date.now() - 60_000 } as never } : {}) }];
    await store.updateWorkerHeartbeat(worker.id, capabilities, "online");
    return (await store.getWorker(worker.id))!;
  }
  const request = chat({ schema: MEMORY_EMBEDDING_SCHEMA, input: ["memoria"] });
  const offers = (hub: Hub) => hub.sent.filter((message) => message.type === "lease.offer").map((message) => message.workerId);

  it("sends memory vectors only to qualified replicas; the pinned qualification probe still reaches an unqualified one", async () => {
    const hub = new Hub();
    const pending = await replica("pending", false);
    hub.connected.add(pending.id);
    const service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    try {
      await expect(service.submit(request)).rejects.toThrow(expect.objectContaining({ code: "native_qualification_unavailable", statusCode: 503 }));
      expect(offers(hub)).toEqual([]);
      const probe = await service.submit({ ...request, workload_class: "benchmark",
        privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: [pending.identityId!] } });
      expect(offers(hub)).toEqual([pending.id]);
      await service.cancel(probe.jobId);

      hub.sent.length = 0;
      const qualified = await replica("qualified", true);
      hub.connected.add(qualified.id);
      const served = await service.submit(request);
      expect(offers(hub)).toEqual([qualified.id]);
      await service.cancel(served.jobId);
    } finally {
      await service.drainEvents();
    }
  });

  it("keeps no_capacity when no memory replica is connected", async () => {
    const service = await MeshService.create(store, new Scheduler(store), new Hub() as unknown as WorkerHub, 30_000);
    await expect(service.submit(request)).rejects.toThrow(expect.objectContaining({ code: "no_capacity", statusCode: 503 }));
    await service.drainEvents();
  });
});
