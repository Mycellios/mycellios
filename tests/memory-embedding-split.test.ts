import { EventEmitter } from "node:events";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_DIMENSIONS, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_PIECE_OVERHEAD_MS,
  MEMORY_EMBEDDING_REVISION, MEMORY_EMBEDDING_SCHEMA, estimatedMemoryEmbeddingTokens, memoryEmbeddingCanaryReference,
  memoryEmbeddingPriorTokensPerSecond, verifiedMemoryEmbeddingEnvelope,
} from "../src/contracts/memory-embedding.js";
import type { ChatCompletionRequest, CompletionResult, JobPayload, ModelDeployment, WorkerCapabilities, WorkerEnvelope } from "../src/contracts/types.js";
import { pieceDeadlineMs, planMemoryEmbeddingPieces } from "../src/coordinator/memory-embedding-split.js";
import { MeshService, type JobStreamEvent } from "../src/coordinator/mesh-service.js";
import { registerNativeReplicaQualifications } from "../src/coordinator/native-replica-qualification.js";
import { completedParts, pieceSummary, withPieceReceipts } from "../src/coordinator/settle-completed-inference.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { MeasuredServiceRates } from "../src/scheduler/measured-service-rates.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredWorker } from "../src/storage/store.js";
import { addWorker, ownNode } from "./helpers.js";
const OWNER = "account-operator";

type Execution = NonNullable<ModelDeployment["execution"]>;
const execution = (node: string, backend: string, precision: string): Execution => {
  const deviceType = backend === "cpu" ? "cpu" : "gpu";
  return { deviceType, backend, deviceName: `${backend} device`, precision, fallback: false,
    stages: [{ nodeId: node, stageIndex: 0, layerStart: 0, layerEnd: 28, deviceType, backend, deviceName: `${backend} device`, precision, fallback: false }] } as Execution;
};

describe("memory embedding piece sizing", () => {
  const covered = (pieces: ReturnType<typeof planMemoryEmbeddingPieces>) => pieces.flatMap((piece) => piece.indices).sort((a, b) => a - b);

  it("sizes pieces in proportion to each replica's speed", () => {
    const tokens = Array(64).fill(150);
    const pieces = planMemoryEmbeddingPieces(tokens, [380, 380, 114, 20]);
    expect(covered(pieces)).toEqual(tokens.map((_, index) => index));
    const share = new Map(pieces.map((piece) => [piece.replica, piece.indices.length]));
    expect(share.get(0)).toBeGreaterThan(share.get(2)!);
    expect(share.get(2)).toBeGreaterThan(share.get(3) ?? 0);
    // Every piece is predicted to end close to the others: nobody waits on a slow device.
    const times = pieces.map((piece) => piece.predictedMs);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual((150 / 20) * 1_000 + 1);
    // Far below the 8 minutes one 20 tokens/s CPU would need for the whole batch.
    expect(Math.max(...times)).toBeLessThan(12_000);
  });

  it("gives a slow replica nothing when even one text would end after the fast replicas", () => {
    const pieces = planMemoryEmbeddingPieces(Array(8).fill(150), [380, 7]);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ replica: 0, indices: [0, 1, 2, 3, 4, 5, 6, 7], tokens: 1_200 });
  });

  it("lets a slow replica take a short text that it finishes in time", () => {
    const pieces = planMemoryEmbeddingPieces([2_000, 2_000, 3], [380, 7]);
    expect(pieces.find((piece) => piece.replica === 1)?.indices).toEqual([2]);
    expect(pieces.find((piece) => piece.replica === 0)?.indices).toEqual([0, 1]);
  });

  it("keeps one piece for one replica and rejects impossible rates", () => {
    expect(planMemoryEmbeddingPieces([5, 6, 7], [100])).toEqual([{ replica: 0, indices: [0, 1, 2], tokens: 18,
      predictedMs: MEMORY_EMBEDDING_PIECE_OVERHEAD_MS + 180 }]);
    expect(() => planMemoryEmbeddingPieces([5], [100, 0])).toThrow(RangeError);
  });

  it("bounds each piece by its prediction and by the request deadline", () => {
    expect(pieceDeadlineMs(1_000, 300_000)).toBe(15_000);
    expect(pieceDeadlineMs(20_000, 300_000)).toBe(70_000);
    expect(pieceDeadlineMs(20_000, 30_000)).toBe(29_750);
    expect(pieceDeadlineMs(1_000, 1_100)).toBeNull();
  });

  it("estimates text sizes without the tokenizer, capped at the runtime truncation", () => {
    expect(estimatedMemoryEmbeddingTokens("abcd")).toBe(2);
    expect(estimatedMemoryEmbeddingTokens("x".repeat(32_768))).toBe(8_192);
    expect(memoryEmbeddingPriorTokensPerSecond(execution("n", "cpu", "float32"))).toBe(7);
    expect(memoryEmbeddingPriorTokensPerSecond(execution("n", "directml", "float32"))).toBe(114);
    expect(memoryEmbeddingPriorTokensPerSecond(execution("n", "directml", "float16"))).toBeNull();
  });
});

describe("measured memory embedding throughput", () => {
  it("starts from the first measurement and shrinks quickly when a device throttles", () => {
    let now = 1_000_000;
    const rates = new MeasuredServiceRates(() => now);
    expect(rates.throughputTokensPerSecond("w", "d")).toBeNull();
    rates.recordThroughput({ workerId: "w", deploymentId: "d", tokens: 3_800, observedMs: 10_750, overheadMs: 750 });
    expect(rates.throughputTokensPerSecond("w", "d")).toBeCloseTo(380, 6);
    // Thermal throttling: the same work now takes four times as long.
    rates.recordThroughput({ workerId: "w", deploymentId: "d", tokens: 3_800, observedMs: 40_750, overheadMs: 750 });
    expect(rates.throughputTokensPerSecond("w", "d")).toBeCloseTo(237.5, 6);
    rates.recordThroughput({ workerId: "w", deploymentId: "d", tokens: 3_800, observedMs: 40_750, overheadMs: 750 });
    expect(rates.throughputTokensPerSecond("w", "d")).toBeLessThan(170);
    rates.recordThroughput({ workerId: "w", deploymentId: "d", tokens: 0, observedMs: 1, overheadMs: 0 });
    expect(rates.throughputTokensPerSecond("w", "d")).toBeLessThan(170);
    now += 7 * 60 * 60_000;
    expect(rates.throughputTokensPerSecond("w", "d")).toBeNull();
  });
});

interface Sent { workerId: string; type: string; payload: unknown }
class Hub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Sent[] = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  send(workerId: string, type: string, payload: unknown): boolean { this.sent.push({ workerId, type, payload }); return this.isConnected(workerId); }
  message(envelope: WorkerEnvelope): void { this.emit("envelope", envelope); }
}

/** Text "t<k>" embeds to the unit vector on axis k, so order is visible in the result. */
const axisOf = (text: string) => Number(text.slice(1, text.indexOf(":") < 0 ? undefined : text.indexOf(":")));
const unit = (axis: number) => Array.from({ length: MEMORY_EMBEDDING_DIMENSIONS }, (_, i) => i === axis ? 1 : 0);
const TOKENS_PER_TEXT = 5;

describe("split memory embedding requests", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  let hub: Hub;
  let service: MeshService | undefined;
  const SOURCE = `sha256:${"a".repeat(64)}`;
  beforeEach(async () => { database = await MeshDatabase.open(":memory:"); store = new MeshStore(database); hub = new Hub(); service = undefined; });
  afterEach(async () => { vi.useRealTimers(); await service?.drainEvents(); await database.close(); });

  async function replica(id: string, backend: string, precision: string): Promise<StoredWorker> {
    const worker = await addWorker(store, { id, model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, maxConcurrency: 1, contextLimit: 524_288 });
    const capabilities: WorkerCapabilities = structuredClone(worker.capabilities);
    capabilities.buildIdentity = { sourceId: SOURCE } as never;
    capabilities.distributedExecutor = { nodeId: `node-${id}` } as never;
    const base = capabilities.deployments[0]!;
    capabilities.deployments = [{ ...base, adapter: "embedding", activationId: `act-${id}`, execution: execution(`node-${id}`, backend, precision),
      verificationState: "verified", nativeReplicaEvidence: { workerId: worker.id, deploymentId: base.deploymentId,
        model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: `act-${id}`, buildSourceId: SOURCE,
        observedAt: Date.now() - 60_000 } as never }];
    await store.updateWorkerHeartbeat(worker.id, capabilities, "online");
    await ownNode(database, worker, OWNER);
    hub.connected.add(worker.id);
    return (await store.getWorker(worker.id))!;
  }
  const request = (texts: string[], extra: Partial<ChatCompletionRequest> = {}): ChatCompletionRequest => ({ model: MEMORY_EMBEDDING_MODEL,
    max_tokens: 1, stream: false, messages: [{ role: "user", content: JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, input: texts }) }], ...extra });
  const start = async () => {
    service = await MeshService.create(store, new Scheduler(store, { serviceBand: 0 }), hub as unknown as WorkerHub, 300_000);
    // Memory embeddings run only on the caller's own nodes; these replicas belong to OWNER.
    const submit = service.submit.bind(service);
    service.submit = (request, session, key, revision, options = {}) => submit(request, session, key, revision, { ownerAccountId: OWNER, ...options });
    return service;
  };
  const offers = () => hub.sent.filter((message) => message.type === "lease.offer") as Array<Sent & { payload: JobPayload }>;
  const textsOf = (offer: { payload: JobPayload }) => (JSON.parse(offer.payload.request.messages[0]!.content) as { input: string[] }).input;

  /** Acts as the replica for one offer: accept, stream the envelope, complete. */
  async function answer(offer: Sent & { payload: JobPayload }, vectors?: number[][]): Promise<void> {
    const { jobId, leaseId } = offer.payload;
    const texts = textsOf(offer);
    const text = JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, result: { object: "list", model: MEMORY_EMBEDDING_MODEL, revision: MEMORY_EMBEDDING_REVISION,
      data: (vectors ?? texts.map((t) => unit(axisOf(t)))).map((embedding, index) => ({ object: "embedding", index, embedding })),
      usage: { prompt_tokens: TOKENS_PER_TEXT * texts.length, total_tokens: TOKENS_PER_TEXT * texts.length } } });
    hub.message({ v: 1, type: "lease.accept", workerId: offer.workerId, payload: { jobId, leaseId } });
    hub.message({ v: 1, type: "task.token", workerId: offer.workerId, payload: { jobId, leaseId, index: 0, text } });
    const result: CompletionResult = { jobId, leaseId, text, finishReason: "stop",
      metrics: { inputTokens: TOKENS_PER_TEXT * texts.length, outputTokens: 0, ttftMs: 1, activeMs: 5 } };
    hub.message({ v: 1, type: "task.complete", workerId: offer.workerId, payload: result });
    await service!.drainEvents();
  }
  async function fail(offer: Sent & { payload: JobPayload }): Promise<void> {
    hub.message({ v: 1, type: "task.fail", workerId: offer.workerId, payload: { jobId: offer.payload.jobId, leaseId: offer.payload.leaseId, code: "adapter_error" } });
    await service!.drainEvents();
  }
  async function settle(events: AsyncIterable<JobStreamEvent>): Promise<JobStreamEvent[]> {
    const seen: JobStreamEvent[] = [];
    for await (const event of events) seen.push(event);
    return seen;
  }
  const texts = (count: number, size = 400) => Array.from({ length: count }, (_, k) => `t${k}:${"x".repeat(size)}`);

  it("spreads one request over idle replicas by speed, keeps the order and sums the usage", async () => {
    const gpu = await replica("gpu", "cuda", "float16");
    const dml = await replica("dml", "directml", "float32");
    await start();
    const input = texts(12);
    const handle = await service!.submit(request(input), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    const firstOffers = offers();
    expect(new Set(firstOffers.map((offer) => offer.workerId))).toEqual(new Set([gpu.id, dml.id]));
    const byWorker = new Map(firstOffers.map((offer) => [offer.workerId, textsOf(offer)]));
    expect(byWorker.get(gpu.id)!.length).toBeGreaterThan(byWorker.get(dml.id)!.length);
    expect([...byWorker.values()].flat().sort()).toEqual([...input].sort());
    // Answer out of order: the slower piece first.
    for (const offer of [...firstOffers].reverse()) await answer(offer);
    const events = await settle(handle.events);
    const completed = events.find((event) => event.type === "completed") as Extract<JobStreamEvent, { type: "completed" }>;
    expect(events[0]).toMatchObject({ type: "accepted", jobId: handle.jobId });
    const envelope = verifiedMemoryEmbeddingEnvelope(completed.result.text, { schema: MEMORY_EMBEDDING_SCHEMA, input, input_type: "document" });
    expect(envelope.result.data.map((row) => row.embedding.indexOf(1))).toEqual(input.map((_, k) => k));
    expect(envelope.result.usage).toEqual({ prompt_tokens: 12 * TOKENS_PER_TEXT, total_tokens: 12 * TOKENS_PER_TEXT });
    expect(completed.result.metrics).toMatchObject({ inputTokens: 12 * TOKENS_PER_TEXT, outputTokens: 0 });
    expect(completed.pieces!.map((piece) => piece.jobId).sort()).toEqual(firstOffers.map((offer) => offer.payload.jobId).sort());
    expect(completedParts(completed)).toHaveLength(2);
    expect(completed.pieces!.every((piece) => piece.networkTrace?.jobId === piece.jobId)).toBe(true);
    expect(await store.getJob(handle.jobId)).toMatchObject({ status: "completed", inputTokens: 12 * TOKENS_PER_TEXT, outputTokens: 0 });
    // Coordinator-measured speed now replaces the priors.
    expect(service!.scheduler.serviceRates.throughputTokensPerSecond(gpu.id, gpu.capabilities.deployments[0]!.deploymentId)).not.toBeNull();
    // The session is free again.
    expect(await service!.cancel(handle.jobId)).toBe(false);
  });

  it("signs a receipt for each piece and settles each piece separately", async () => {
    await replica("gpu", "cuda", "float16");
    await replica("dml", "directml", "float32");
    await start();
    const handle = await service!.submit(request(texts(6)), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    for (const offer of offers()) await answer(offer);
    const completed = (await settle(handle.events)).find((event) => event.type === "completed") as Extract<JobStreamEvent, { type: "completed" }>;
    const attach = vi.fn(async (event: Extract<JobStreamEvent, { type: "completed" }>) => ({ ...event, result: { ...event.result, executionReceiptId: `r-${event.result.jobId}` } }));
    const signed = await withPieceReceipts(completed, attach);
    expect(attach).toHaveBeenCalledTimes(2);
    expect(signed.result.executionReceiptId).toBeUndefined();
    expect(pieceSummary(signed).pieces!.map((piece) => piece.execution_receipt_id)).toEqual(signed.pieces!.map((piece) => `r-${piece.jobId}`));
    expect(completedParts(signed).reduce((sum, part) => sum + part.metrics.inputTokens, 0)).toBe(signed.result.metrics.inputTokens);
    // An ordinary completion keeps exactly one receipt and one settlement.
    const single = { type: "completed", result: { ...completed.result, jobId: "job-single" } } as Extract<JobStreamEvent, { type: "completed" }>;
    expect((await withPieceReceipts(single, attach)).result.executionReceiptId).toBe("r-job-single");
    expect(completedParts(single)).toEqual([single.result]);
    expect(pieceSummary(single)).toEqual({});
  });

  it("re-dispatches a failed piece once to a different replica", async () => {
    const gpu = await replica("gpu", "cuda", "float16");
    const dml = await replica("dml", "directml", "float32");
    await start();
    const input = texts(8);
    const handle = await service!.submit(request(input), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    const [first, second] = [offers().find((offer) => offer.workerId === gpu.id)!, offers().find((offer) => offer.workerId === dml.id)!];
    await fail(second);
    await answer(first);
    await vi.waitFor(() => expect(offers()).toHaveLength(3), { timeout: 3_000 });
    const retry = offers()[2]!;
    expect(retry.workerId).toBe(gpu.id);
    expect(textsOf(retry)).toEqual(textsOf(second));
    await answer(retry);
    const events = await settle(handle.events);
    const completed = events.find((event) => event.type === "completed") as Extract<JobStreamEvent, { type: "completed" }>;
    const envelope = verifiedMemoryEmbeddingEnvelope(completed.result.text, { schema: MEMORY_EMBEDDING_SCHEMA, input, input_type: "document" });
    expect(envelope.result.data.map((row) => row.embedding.indexOf(1))).toEqual(input.map((_, k) => k));
    // The failed attempt is not billed: usage counts each text once.
    expect(completed.result.metrics.inputTokens).toBe(8 * TOKENS_PER_TEXT);
  });

  it("fails cleanly when a piece also fails on its second replica", async () => {
    const gpu = await replica("gpu", "cuda", "float16");
    const dml = await replica("dml", "directml", "float32");
    await start();
    const handle = await service!.submit(request(texts(8)), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    const [first, second] = [offers().find((offer) => offer.workerId === gpu.id)!, offers().find((offer) => offer.workerId === dml.id)!];
    await fail(second);
    await answer(first);
    await vi.waitFor(() => expect(offers()).toHaveLength(3), { timeout: 3_000 });
    await fail(offers()[2]!);
    const events = await settle(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "adapter_error" });
    expect(await store.getJob(handle.jobId)).toMatchObject({ status: "failed", failureCode: "adapter_error" });
  });

  it("does not let a stalled slow replica block the request", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const gpu = await replica("gpu", "cuda", "float16");
    const cpu = await replica("cpu", "cpu", "float32");
    await start();
    // Two long texts for the GPU and one short one the CPU can finish in time.
    const input = ["t0:" + "x".repeat(8_000), "t1:" + "x".repeat(8_000), "t2:abc"];
    const handle = await service!.submit(request(input), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    const cpuOffer = offers().find((offer) => offer.workerId === cpu.id)!;
    expect(textsOf(cpuOffer)).toEqual(["t2:abc"]);
    await answer(offers().find((offer) => offer.workerId === gpu.id)!);
    hub.message({ v: 1, type: "lease.accept", workerId: cpu.id, payload: { jobId: cpuOffer.payload.jobId, leaseId: cpuOffer.payload.leaseId } });
    await service!.drainEvents();
    // The CPU never answers: its piece runs out of its own budget, far before the request deadline.
    await vi.advanceTimersByTimeAsync(15_000);
    await service!.drainEvents();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(offers()).toHaveLength(3));
    const retry = offers()[2]!;
    expect(retry.workerId).toBe(gpu.id);
    await answer(retry);
    const events = await settle(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "completed" });
    // The stalled piece ended unanswered (first-token or piece deadline), and was never billed.
    expect(["failed", "expired"]).toContain((await store.getJob(cpuOffer.payload.jobId))!.status);
    expect((events.at(-1) as Extract<JobStreamEvent, { type: "completed" }>).result.metrics.inputTokens).toBe(3 * TOKENS_PER_TEXT);
  });

  it("fails the whole request at its deadline and cancels the pieces", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const gpu = await replica("gpu", "cuda", "float16");
    await replica("dml", "directml", "float32");
    await start();
    const handle = await service!.submit(request(texts(4), { deadline_ms: 5_000 }), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    expect(offers()).toHaveLength(2);
    await answer(offers().find((offer) => offer.workerId === gpu.id)!);
    await vi.advanceTimersByTimeAsync(5_001);
    await service!.drainEvents();
    const events = await settle(handle.events);
    expect(events.at(-1)).toMatchObject({ type: "failed", code: "deadline_exceeded" });
    expect(await store.getJob(handle.jobId)).toMatchObject({ status: "expired", failureCode: "deadline_exceeded" });
    expect(hub.sent.some((message) => message.type === "task.cancel")).toBe(true);
  });

  it("cancels every running piece with the request", async () => {
    await replica("gpu", "cuda", "float16");
    await replica("dml", "directml", "float32");
    await start();
    const handle = await service!.submit(request(texts(4)), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    expect(await service!.cancel(handle.jobId)).toBe(true);
    await service!.drainEvents();
    expect((await settle(handle.events)).at(-1)).toMatchObject({ type: "failed", code: "cancelled" });
    for (const offer of offers()) expect((await store.getJob(offer.payload.jobId))!.status).toBe("cancelled");
    expect(await store.getJob(handle.jobId)).toMatchObject({ status: "cancelled" });
  });

  it("keeps funded, streaming and single-replica requests on one replica", async () => {
    await replica("gpu", "cuda", "float16");
    await replica("dml", "directml", "float32");
    await start();
    for (const [extra, options] of [
      [{}, { splitMemoryEmbedding: true, requireSettlementEvidence: true }],
      [{ stream: true }, { splitMemoryEmbedding: true }],
      [{}, {}],
    ] as const) {
      hub.sent.length = 0;
      const handle = await service!.submit(request(texts(6), extra), undefined, undefined, undefined, options);
      expect(offers()).toHaveLength(1);
      expect(textsOf(offers()[0]!)).toHaveLength(6);
      await service!.cancel(handle.jobId);
      await service!.drainEvents();
    }
  });

  it("serves unfunded requests from a qualified CPU replica but keeps funded ones off it", async () => {
    const cpu = await replica("cpu", "cpu", "float32");
    await start();
    const handle = await service!.submit(request(["t0:a"]), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    expect(offers().map((offer) => offer.workerId)).toEqual([cpu.id]);
    await answer(offers()[0]!);
    expect((await settle(handle.events)).at(-1)).toMatchObject({ type: "completed" });
    await expect(service!.submit(request(["t0:a"]), undefined, undefined, undefined, { requireSettlementEvidence: true }))
      .rejects.toThrow(expect.objectContaining({ code: "settlement_evidence_unavailable", statusCode: 502 }));
  });

  it("feeds a slower measurement back into the next split", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const gpu = await replica("gpu", "cuda", "float16");
    const dml = await replica("dml", "directml", "float32");
    await start();
    const before = (await service!.submit(request(texts(16)), undefined, undefined, undefined, { splitMemoryEmbedding: true }));
    const gpuShareBefore = textsOf(offers().find((offer) => offer.workerId === gpu.id)!).length;
    // The GPU throttles: its piece takes 12 s instead of about 4 s.
    await answer(offers().find((offer) => offer.workerId === dml.id)!);
    const slow = offers().find((offer) => offer.workerId === gpu.id)!;
    hub.message({ v: 1, type: "lease.accept", workerId: gpu.id, payload: { jobId: slow.payload.jobId, leaseId: slow.payload.leaseId } });
    await service!.drainEvents();
    await vi.advanceTimersByTimeAsync(12_000);
    await answer(slow);
    await settle(before.events);
    const measured = service!.scheduler.serviceRates.throughputTokensPerSecond(gpu.id, gpu.capabilities.deployments[0]!.deploymentId)!;
    expect(measured).toBeLessThan(380);
    hub.sent.length = 0;
    const after = await service!.submit(request(texts(16)), undefined, undefined, undefined, { splitMemoryEmbedding: true });
    const gpuShareAfter = textsOf(offers().find((offer) => offer.workerId === gpu.id)!).length;
    expect(gpuShareAfter).toBeLessThan(gpuShareBefore);
    await service!.cancel(after.jobId);
  });
});

describe("native qualification of a CPU fp32 memory replica", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  async function qualify(backend: string, precision: string, traceDevice: string) {
    const app = Fastify(); apps.push(app);
    const sha = (c: string) => `sha256:${c.repeat(64)}`;
    const worker = { id: "worker-cpu", status: "online", identityId: "hp-cell", capabilities: {
      buildIdentity: { schema: "mycellios-native-build-provenance/1", version: "0.2.77", sourceId: sha("1") },
      gpus: [], deployments: [{ deploymentId: "dep-cpu", activationId: "act-cpu", model: MEMORY_EMBEDDING_MODEL,
        modelDigest: MEMORY_EMBEDDING_DIGEST, adapter: "embedding", mode: "replica", maxConcurrency: 1, freeSlots: 1,
        execution: execution("hp-probook", backend, precision) }],
    } } as unknown as StoredWorker;
    const vector = Array.from(memoryEmbeddingCanaryReference());
    const text = JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, result: { object: "list", model: MEMORY_EMBEDDING_MODEL, revision: MEMORY_EMBEDDING_REVISION,
      data: [{ object: "embedding", index: 0, embedding: vector }], usage: { prompt_tokens: 12, total_tokens: 12 } } });
    let next = 0;
    registerNativeReplicaQualifications(app, {
      adminToken: "operator-admin", networkToken: "operator-network",
      hub: { currentWorkerSessionId: () => "session-1", setWorkerMaintenance: async () => {} },
      store: { database: { transaction: async (action) => await action() }, getWorker: async () => worker,
        updateWorkerHeartbeat: async (_id, capabilities) => { worker.capabilities = capabilities; } },
      service: { submit: (async () => {
        const index = ++next;
        const events = (async function* (): AsyncIterable<JobStreamEvent> {
          yield { type: "completed", result: { jobId: `job-${index}`, text, metrics: { inputTokens: 12, outputTokens: 0, ttftMs: 1, activeMs: 10 },
            networkTrace: { selectedRoute: [{ workerId: worker.id, deploymentId: "dep-cpu" }],
              stages: [{ nodeId: "hp-probook", deviceType: traceDevice, modelDigest: MEMORY_EMBEDDING_DIGEST }] } } } as unknown as JobStreamEvent;
        })();
        return { jobId: `job-${index}`, sessionId: "", events };
      }) as unknown as MeshService["submit"], cancel: vi.fn(async () => true) },
      attachReceipt: (event) => ({ ...event, result: { ...event.result, executionReceiptId: sha(String(next)) } }),
    });
    return await app.inject({ method: "POST", url: "/internal/v1/native-replica-qualifications",
      headers: { authorization: "Bearer operator-network", "x-mycellios-admin-token": "operator-admin" },
      payload: { workerId: worker.id, deploymentId: "dep-cpu" } });
  }

  it("qualifies CPU fp32 with the same canary and keeps refusing other CPU precisions", async () => {
    const qualified = await qualify("cpu", "float32", "cpu");
    expect(qualified.statusCode).toBe(200);
    expect(qualified.json().data).toMatchObject({ responseKind: "embedding", physicalNodeId: "hp-probook" });
    expect((await qualify("cpu", "float32", "gpu")).statusCode).toBe(422);
    expect((await qualify("cpu", "bfloat16", "cpu")).statusCode).toBe(422);
    expect((await qualify("directml", "float16", "gpu")).statusCode).toBe(422);
  });
});
