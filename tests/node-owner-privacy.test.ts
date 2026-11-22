import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdapterError, type InferenceAdapter } from "../src/adapters/base.js";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import type { ChatCompletionRequest, JobPayload, WorkerCapabilities } from "../src/contracts/types.js";
import { parseChatRequest } from "../src/coordinator/chat-admission.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { WorkerRequestView } from "../src/coordinator/worker-request-view.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { WorkerAgent } from "../src/worker/agent.js";
import { contentFreeFailure } from "../src/worker/content-free-failure.js";
import { addWorker } from "./helpers.js";

class FakeWorkerHub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];

  connectedWorkerIds(): ReadonlySet<string> {
    return new Set(this.connected);
  }

  isConnected(workerId: string): boolean {
    return this.connected.has(workerId);
  }

  send(workerId: string, type: string, payload: unknown): boolean {
    this.sent.push({ workerId, type, payload });
    return this.isConnected(workerId);
  }
}

const KEY = Buffer.alloc(32, 7);

describe("worker view of a request", () => {
  const request: ChatCompletionRequest = {
    model: "distributed-small",
    messages: [
      { role: "system", content: "Be brief." },
      { role: "user", content: "hello", name: "Alex" },
    ],
    session_id: "support-conversation-1234",
    preferred_region: "es-mad",
    seed: 42,
    temperature: 0.2,
    privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: ["node-a"] },
    dispersion: { group: "recording-0123456789abcdef" },
  };

  it("drops routing policy, region and participant names but keeps content and sampling", () => {
    const view = new WorkerRequestView(KEY).build(request, "wrk_a");
    expect(view).not.toHaveProperty("privacy");
    expect(view).not.toHaveProperty("preferred_region");
    expect(view).not.toHaveProperty("dispersion");
    expect(view.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "hello" },
    ]);
    expect(view.seed).toBe(42);
    expect(view.temperature).toBe(0.2);
    expect(request.messages[1]).toHaveProperty("name", "Alex");
    expect(request.privacy).toBeDefined();
  });

  it("gives each worker a stable pseudonym that hides the session id and its prefix", () => {
    const views = new WorkerRequestView(KEY);
    const first = views.build(request, "wrk_a").session_id!;
    expect(first).toMatch(/^s_[A-Za-z0-9_-]{22}$/);
    expect(first).not.toContain("support");
    expect(views.build(request, "wrk_a").session_id).toBe(first);
    expect(views.build(request, "wrk_b").session_id).not.toBe(first);
    expect(views.build({ ...request, session_id: "other" }, "wrk_a").session_id).not.toBe(first);
    expect(new WorkerRequestView(Buffer.alloc(32, 8)).build(request, "wrk_a").session_id).not.toBe(first);
  });

  it("adds no session when the client sent none", () => {
    const { session_id: _session, ...withoutSession } = request;
    expect(new WorkerRequestView(KEY).build(withoutSession, "wrk_a")).not.toHaveProperty("session_id");
  });

  it("refuses a short key", () => {
    expect(() => new WorkerRequestView(Buffer.alloc(16))).toThrow(RangeError);
  });
});

describe("lease offers carry only the worker view", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  let hub: FakeWorkerHub;
  let service: MeshService | undefined;

  beforeEach(async () => {
    database = await MeshDatabase.open(":memory:");
    store = new MeshStore(database);
    hub = new FakeWorkerHub();
  });

  afterEach(async () => {
    await service?.drainEvents();
    await database.close();
  });

  it("sends no client session id, privacy policy or participant name to the node", async () => {
    const worker = await addWorker(store, { id: "contributor" });
    hub.connected.add(worker.id);
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    const handle = await service.submit({
      model: "distributed-small",
      messages: [{ role: "user", content: "private note", name: "Alex" }],
      session_id: "conversation-of-account-42",
      privacy: { trust: "trusted-only", boundary: "trusted-edges" },
    });
    try {
      const offer = hub.sent.find((message) => message.type === "lease.offer");
      const payload = offer!.payload as JobPayload;
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("conversation-of-account-42");
      expect(serialized).not.toContain("Alex");
      expect(payload.request).not.toHaveProperty("privacy");
      expect(payload.request.session_id).toMatch(/^s_/);
      expect(payload.request.messages).toEqual([{ role: "user", content: "private note" }]);
      expect((await store.getJob(handle.jobId))!.sessionId).toBe("conversation-of-account-42");
    } finally {
      await service.cancel(handle.jobId);
    }
  });
});

describe("pins cannot be answered by another identity kind", () => {
  let database: MeshDatabase;

  beforeEach(async () => {
    database = await MeshDatabase.open(":memory:");
  });

  afterEach(async () => {
    await database.close();
  });

  it("refuses to admit an identity id that already belongs to another kind", async () => {
    const device = await database.admitWorkerCredential({
      identityKind: "device", identityId: "node-pinned", algorithm: "ed25519",
      publicKey: "device-key", fingerprint: "sha256:device", protocolVersion: 1,
    });
    expect(device.state).toBe("enrolled");
    const cell = await database.admitWorkerCredential({
      identityKind: "cell", identityId: "node-pinned", algorithm: "ed25519",
      publicKey: "cell-key", fingerprint: "sha256:cell", protocolVersion: 1,
    });
    expect(cell.state).toBe("identity_kind_conflict");
    expect(await database.getWorkerAdmissionCredential("cell", "node-pinned")).toBeNull();
  });

  it("fails a pinned route closed while two kinds share the pinned id", async () => {
    const store = new MeshStore(database);
    const hub = new FakeWorkerHub();
    const genuine = await addWorker(store, { id: "genuine", identity: { kind: "device", id: "node-pinned" } });
    const impostor = await addWorker(store, {
      id: "impostor", identity: { kind: "cell", id: "node-pinned" }, tokensPerSecond: 500, ttftMs: 1,
    });
    hub.connected.add(genuine.id);
    hub.connected.add(impostor.id);
    const service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    try {
      await expect(service.submit({
        model: "distributed-small",
        messages: [{ role: "user", content: "pinned" }],
        privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: ["node-pinned"] },
      })).rejects.toThrow(expect.objectContaining({ code: "boundary_pin_unavailable" }));
      expect(hub.sent.filter((message) => message.type === "lease.offer")).toHaveLength(0);
    } finally {
      await service.drainEvents();
    }
  });
});

describe("content-free worker failures", () => {
  it("never repeats what a JSON parse error quoted", () => {
    let parseError: unknown;
    try {
      JSON.parse("patient Maria Lopez has diabetes");
    } catch (error) {
      parseError = error;
    }
    expect(String((parseError as Error).message)).toContain("patient");
    expect(contentFreeFailure(parseError)).toBe("invalid_runtime_output");
  });

  it("keeps an adapter code but drops a message that carries a runtime body", () => {
    const body = new AdapterError(
      'Mycellios pipeline generation failed (500): {"error":"prompt was: my bank pin is 1234"}',
      "mycellios_pipeline_generation_failed",
      true,
    );
    expect(contentFreeFailure(body)).toBe("mycellios_pipeline_generation_failed");
  });

  it("keeps short operational messages", () => {
    const http = new AdapterError("Transcription runtime returned HTTP 503", "transcription_runtime_failed", true);
    expect(contentFreeFailure(http)).toBe("transcription_runtime_failed: Transcription runtime returned HTTP 503");
    expect(contentFreeFailure(new Error("Inference deadline exceeded"))).toBe("Error: Inference deadline exceeded");
    expect(contentFreeFailure(new TypeError(`Cannot read "secret"`))).toBe("TypeError");
    expect(contentFreeFailure("raw string")).toBe("adapter_error");
  });
});

describe("a failed job leaves no content in the PC's log or in task.fail", () => {
  it("logs and reports only a code when the runtime output does not parse", async () => {
    const logged: string[] = [];
    const agent = new WorkerAgent(workerConfigSchema.parse({
      region: "test",
      offeredVramMb: 4_096,
      limits: { maxConcurrency: 1, pauseWhenForeground: false },
      adapter: { kind: "mock", developmentOnly: true, model: "test-model", tokensPerSecond: 1_000, ttftMs: 0, failureRate: 0 },
      deployment: { modelDigest: "sha256:test", contextLimit: 8_192 },
    }), {
      coordinatorUrl: "http://127.0.0.1:9999",
      reconnect: false,
      logger: { info() {}, warn() {}, error(message: string) { logged.push(message); } },
    });
    const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const harness = agent as unknown as {
      registeredWorkerId?: string;
      capabilities: WorkerCapabilities;
      socket: { readyState: number; send(serialized: string): void };
      adapter: InferenceAdapter;
      execute(payload: JobPayload): Promise<void>;
    };
    harness.registeredWorkerId = "worker-test";
    harness.capabilities = {
      region: "test",
      agentVersion: "test",
      gpus: [{ id: "gpu", vendor: "test", model: "test", physicalVramMb: 4_096, offeredVramMb: 4_096, freeOfferedVramMb: 4_096 }],
      limits: { maxConcurrency: 1, pauseWhenForeground: false },
      deployments: [{
        deploymentId: "deployment-test", model: "test-model", modelDigest: "sha256:test", mode: "replica", adapter: "mock",
        peakVramMb: 2_048, contextLimit: 8_192, maxConcurrency: 1, freeSlots: 1, tokensPerSecond: 10, ttftMs: 10, dataLocality: "local",
      }],
      network: { coordinatorRttMs: 1, uplinkMbps: 10, downlinkMbps: 10 },
    };
    harness.socket = { readyState: 1, send: (value) => sent.push(JSON.parse(value)) };
    harness.adapter = {
      kind: "mock",
      async probe() { return { kind: "mock", models: ["test-model"], streaming: true, embeddings: false, reranking: false }; },
      async warm() {},
      // eslint-disable-next-line require-yield
      async *generate() { JSON.parse("the secret diagnosis is"); },
      async cancel() {},
      async metrics() { return { ready: true, activeJobs: 0, loadedModels: ["test-model"] }; },
    };
    await harness.execute({
      jobId: "job-private", leaseId: "lease-private", modelDigest: "sha256:test", deadlineAt: Date.now() + 60_000,
      request: { model: "test-model", messages: [{ role: "user", content: "the secret diagnosis is" }], max_tokens: 8 },
    });
    const failure = sent.find((message) => message.type === "task.fail")!.payload;
    expect(failure).toMatchObject({ code: "adapter_error", message: "invalid_runtime_output" });
    expect(logged.join(" ")).toContain("job-private");
    expect(logged.join(" ")).not.toContain("secret");
  });
});

describe("no trusted-machines tier for public callers (D7)", () => {
  it("accepts but ignores a public privacy policy", () => {
    const parsed = parseChatRequest({
      model: "distributed-small",
      messages: [{ role: "user", content: "hello" }],
      privacy: { trust: "trusted-only", boundary: "pinned-edges", pinned_identity_ids: ["node-a"] },
    });
    expect(parsed).not.toHaveProperty("privacy");
    expect(parsed.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(() => parseChatRequest({ model: "m", messages: [{ role: "user", content: "x" }],
      privacy: { trust: "default", boundary: "pinned-edges" } })).toThrow();
  });
});
