import { EventEmitter } from "node:events";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_MODEL, MEMORY_EMBEDDING_SCHEMA } from "../src/contracts/memory-embedding.js";
import { nodeReplicasResponseSchema } from "../src/contracts/node-replicas.js";
import type { ChatCompletionRequest, ModelDeployment, WorkerCapabilities } from "../src/contracts/types.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import { approvedReplicaAccounts, MemoryEmbeddingOwnerDemand, registerNodeReplicaRoutes } from "../src/coordinator/node-replica-demand.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore, type StoredWorker } from "../src/storage/store.js";
import { addWorker, ownNode } from "./helpers.js";

const SOURCE = `sha256:${"a".repeat(64)}`;
const execution = (nodeId: string) => ({ deviceType: "gpu", backend: "cuda", deviceName: "RTX", precision: "float16", fallback: false,
  stages: [{ nodeId, stageIndex: 0, layerStart: 0, layerEnd: 28, deviceType: "gpu", backend: "cuda", deviceName: "RTX",
    precision: "float16", fallback: false }] }) as unknown as ModelDeployment["execution"];

class Hub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly sent: Array<{ workerId: string; type: string; payload?: unknown }> = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  send(workerId: string, type: string, payload?: unknown): boolean { this.sent.push({ workerId, type, payload }); return this.isConnected(workerId); }
}

describe("memory embeddings run only on the requesting account's nodes", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  let hub: Hub;
  let service: MeshService;
  beforeEach(async () => {
    database = await MeshDatabase.open(":memory:");
    store = new MeshStore(database);
    hub = new Hub();
    service = await MeshService.create(store, new Scheduler(store, { serviceBand: 0 }), hub as unknown as WorkerHub, 30_000);
  });
  afterEach(async () => { await service.drainEvents(); await database.close(); });

  async function replica(id: string, owner: string | null, options: { kind?: "device" | "cell"; status?: "active" | "revoked"; qualified?: boolean } = {}): Promise<StoredWorker> {
    const identity = { kind: options.kind ?? "device", id: `identity-${id}` } as const;
    const worker = await addWorker(store, { id, model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, maxConcurrency: 1, contextLimit: 524_288, identity });
    const capabilities: WorkerCapabilities = structuredClone(worker.capabilities);
    capabilities.buildIdentity = { sourceId: SOURCE } as never;
    const base = capabilities.deployments[0]!;
    capabilities.deployments = [{ ...base, adapter: "embedding", activationId: `act-${id}`, execution: execution(`node-${id}`),
      ...(options.qualified === false ? {} : { verificationState: "verified", nativeReplicaEvidence: { workerId: worker.id, deploymentId: base.deploymentId,
        model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, activationId: `act-${id}`, buildSourceId: SOURCE,
        observedAt: Date.now() - 60_000 } as never }) }];
    await store.updateWorkerHeartbeat(worker.id, capabilities, "online");
    if (owner) await ownNode(database, worker, owner, options.status ?? "active");
    hub.connected.add(worker.id);
    return (await store.getWorker(worker.id))!;
  }
  const request = (input: string[] = ["memoria privada"]): ChatCompletionRequest => ({ model: MEMORY_EMBEDDING_MODEL, max_tokens: 1, stream: false,
    messages: [{ role: "user", content: JSON.stringify({ schema: MEMORY_EMBEDDING_SCHEMA, input }) }] });
  const offeredTo = () => hub.sent.filter((message) => message.type === "lease.offer").map((message) => message.workerId);
  const submitAs = async (owner: string | null, options: { split?: boolean } = {}) => await service.submit(request(options.split ? ["uno", "dos", "tres", "cuatro"] : undefined),
    undefined, undefined, undefined, { ownerAccountId: owner, ...(options.split ? { splitMemoryEmbedding: true } : {}) });

  it("never offers a lease to another account's node, whichever account asks", async () => {
    const mine = await replica("mine", "account-a");
    const theirs = await replica("theirs", "account-b");
    const handle = await submitAs("account-a");
    expect(offeredTo()).toEqual([mine.id]);
    await service.cancel(handle.jobId);
    hub.sent.length = 0;
    const other = await submitAs("account-b");
    expect(offeredTo()).toEqual([theirs.id]);
    await service.cancel(other.jobId);
  });

  it("answers no_capacity without revealing that other accounts have replicas", async () => {
    await replica("theirs", "account-b");
    await replica("unqualified-theirs", "account-b", { qualified: false });
    await expect(submitAs("account-c")).rejects.toThrow(expect.objectContaining({ code: "no_capacity", statusCode: 503 }));
    expect(offeredTo()).toEqual([]);
  });

  it("refuses a request without an authenticated owner account before creating work", async () => {
    await replica("mine", "account-a");
    await expect(submitAs(null)).rejects.toThrow(expect.objectContaining({ code: "memory_embedding_owner_required", statusCode: 403 }));
    await expect(service.submit(request())).rejects.toThrow(expect.objectContaining({ code: "memory_embedding_owner_required" }));
    expect(offeredTo()).toEqual([]);
    expect(await store.listNonterminalJobs()).toEqual([]);
  });

  it("excludes revoked and unowned identities but admits enrolled replica cells", async () => {
    await replica("revoked", "account-a", { status: "revoked" });
    await replica("unowned", null);
    await expect(submitAs("account-a")).rejects.toThrow(expect.objectContaining({ code: "no_capacity" }));
    expect(offeredTo()).toEqual([]);
    const cell = await replica("cell", "account-a", { kind: "cell" });
    const handle = await submitAs("account-a");
    expect(offeredTo()).toEqual([cell.id]);
    await service.cancel(handle.jobId);
  });

  it("splits a request only across the caller's own replicas", async () => {
    const first = await replica("mine-1", "account-a");
    const second = await replica("mine-2", "account-a");
    const theirs = await replica("theirs", "account-b");
    const handle = await submitAs("account-a", { split: true });
    const offered = offeredTo();
    expect(offered.length).toBe(2);
    expect(new Set(offered)).toEqual(new Set([first.id, second.id]));
    expect(offered).not.toContain(theirs.id);
    await service.cancel(handle.jobId);
  });

  it("reports owner-bound demand, including requests that found only unqualified replicas", async () => {
    const events: Array<{ model: string; served: boolean; ownerAccountId?: string | null }> = [];
    service.on("demand", (event) => events.push(event));
    await replica("pending", "account-a", { qualified: false });
    await expect(submitAs("account-a")).rejects.toThrow(expect.objectContaining({ code: "native_qualification_unavailable" }));
    expect(events).toEqual([{ model: MEMORY_EMBEDDING_MODEL, served: false, ownerAccountId: "account-a" }]);
  });

  it("checks capacity against the caller's own nodes", async () => {
    await replica("theirs", "account-b");
    expect(await service.hasCapacity(request(), undefined, "account-a")).toBe(false);
    expect(await service.hasCapacity(request(), undefined, "account-b")).toBe(true);
  });
});

describe("node replica demand", () => {
  it("accepts only an explicit, bounded list of approved owner accounts", () => {
    expect([...approvedReplicaAccounts(undefined)]).toEqual([]);
    expect([...approvedReplicaAccounts(" account-a, account-b ")]).toEqual(["account-a", "account-b"]);
    expect(() => approvedReplicaAccounts("account a")).toThrow("memory_embedding_node_replica_accounts_invalid");
  });

  it("wants a replica only for an approved account with recent memory embedding demand", () => {
    const demand = new MemoryEmbeddingOwnerDemand(new Set(["account-a"]), 600_000);
    expect(demand.desired("account-a", 1_000)).toBe(false);
    demand.record("other-model", "account-a", 1_000);
    demand.record(MEMORY_EMBEDDING_MODEL, "account-b", 1_000);
    expect(demand.desired("account-a", 2_000)).toBe(false);
    expect(demand.desired("account-b", 2_000)).toBe(false);
    demand.record(MEMORY_EMBEDDING_MODEL, "account-a", 1_000);
    expect(demand.desired("account-a", 2_000)).toBe(true);
    expect(demand.desired("account-a", 601_000)).toBe(false);
    expect(demand.desired(null, 2_000)).toBe(false);
  });

  it("answers a node with its own owner's demand, and only to that node's session", async () => {
    const app = Fastify();
    const service = new EventEmitter();
    const owners: Record<string, string> = { "node-a": "account-a", "node-b": "account-b" };
    let principal: string | null = null;
    registerNodeReplicaRoutes(app, {
      database: { getNodeOwnership: async (_kind, id) => owners[id] ? { identityKind: "device", identityId: id, accountId: owners[id]!,
        credentialFingerprint: "x", status: "active", generation: 1, createdAt: 0, updatedAt: 0 } as never : null },
      service, sessionPrincipal: () => principal,
      demand: new MemoryEmbeddingOwnerDemand(new Set(["account-a", "account-b"])),
    });
    try {
      const ask = async (node: string) => await app.inject({ method: "GET", url: `/internal/v1/nodes/${node}/replicas` });
      expect((await ask("node-a")).statusCode).toBe(401);
      principal = "node-b";
      expect((await ask("node-a")).statusCode).toBe(401);
      service.emit("demand", { model: MEMORY_EMBEDDING_MODEL, served: false, ownerAccountId: "account-a" });
      const b = nodeReplicasResponseSchema.parse((await ask("node-b")).json());
      expect(b.replicas).toEqual([{ model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST, desired: false }]);
      principal = "node-a";
      const a = nodeReplicasResponseSchema.parse((await ask("node-a")).json());
      expect(a).toMatchObject({ nodeId: "node-a", replicas: [{ desired: true }] });
    } finally { await app.close(); }
  });
});
