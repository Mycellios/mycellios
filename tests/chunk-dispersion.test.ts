import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionRequest, JobPayload, WorkerEnvelope } from "../src/contracts/types.js";
import { chatCompletionRequestSchema } from "../src/contracts/schemas.js";
import { DispersionGroups, publicNetworkPrefix } from "../src/coordinator/dispersion-groups.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

class Hub extends EventEmitter {
  readonly connected = new Set<string>();
  readonly addresses = new Map<string, string>();
  readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];
  connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
  isConnected(workerId: string): boolean { return this.connected.has(workerId); }
  workerNetworkAddress(workerId: string): string | null { return this.addresses.get(workerId) ?? null; }
  send(workerId: string, type: string, payload: unknown): boolean {
    this.sent.push({ workerId, type, payload });
    return this.isConnected(workerId);
  }
  offers(): Array<{ workerId: string; payload: JobPayload }> {
    return this.sent.filter((message) => message.type === "lease.offer")
      .map((message) => ({ workerId: message.workerId, payload: message.payload as JobPayload }));
  }
}

const GROUP = "recording-0123456789abcdef";

function piece(index: number, group = GROUP): ChatCompletionRequest {
  return { model: "distributed-small", messages: [{ role: "user", content: `piece ${index}` }], dispersion: { group } };
}

describe("network prefixes", () => {
  it("groups public addresses by /24 and /48 and ignores private, overlay and tunnel addresses", () => {
    expect(publicNetworkPrefix("203.0.113.77")).toBe("203.0.113.0/24");
    expect(publicNetworkPrefix("::ffff:203.0.113.5")).toBe("203.0.113.0/24");
    expect(publicNetworkPrefix("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(publicNetworkPrefix("2001:0db8:00ab::7")).toBe("2001:db8:ab::/48");
    for (const address of ["10.0.0.4", "172.20.1.1", "192.168.1.9", "100.102.50.179", "127.0.0.1", "169.254.1.1", "::1", "fd00::1", "fe80::1", "", "nonsense"]) {
      expect(publicNetworkPrefix(address)).toBeNull();
    }
    expect(publicNetworkPrefix(null)).toBeNull();
  });
});

describe("dispersion groups", () => {
  it("lets a job reuse its own keys but not another job's", () => {
    const groups = new DispersionGroups();
    groups.reserve("g", "job-1", ["worker:a", "owner:x"]);
    expect(groups.conflicts("g", "job-1", ["worker:a"])).toBe(false);
    expect(groups.conflicts("g", "job-2", ["worker:b", "owner:x"])).toBe(true);
    expect(groups.conflicts("other", "job-2", ["worker:a"])).toBe(false);
  });

  it("forgets a group after its time to live", () => {
    let now = 0;
    const groups = new DispersionGroups({ ttlMs: 1_000, now: () => now });
    groups.reserve("g", "job-1", ["worker:a"]);
    now = 1_001;
    expect(groups.conflicts("g", "job-2", ["worker:a"])).toBe(false);
  });

  it("runs work for one group one at a time", async () => {
    const groups = new DispersionGroups();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = groups.exclusive("g", async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      order.push("first:end");
    });
    const second = groups.exclusive("g", async () => { order.push("second"); });
    await Promise.resolve();
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("evicts the least recently used group when full", () => {
    const groups = new DispersionGroups({ maxGroups: 2 });
    groups.reserve("a", "job-a", ["worker:a"]);
    groups.reserve("b", "job-b", ["worker:b"]);
    groups.reserve("a", "job-a2", ["worker:c"]);
    groups.reserve("c", "job-c", ["worker:d"]);
    expect(groups.conflicts("a", "job-x", ["worker:a"])).toBe(true);
    expect(groups.conflicts("b", "job-x", ["worker:b"])).toBe(false);
  });

  it("accepts only an opaque bounded group in the public request", () => {
    expect(chatCompletionRequestSchema.safeParse(piece(1)).success).toBe(true);
    expect(chatCompletionRequestSchema.safeParse(piece(1, "short")).success).toBe(false);
    expect(chatCompletionRequestSchema.safeParse(piece(1, "has spaces in it 1234")).success).toBe(false);
    expect(chatCompletionRequestSchema.safeParse({ ...piece(1), dispersion: { group: GROUP, extra: 1 } }).success).toBe(false);
  });
});

describe("pieces of one recording through the mesh service", () => {
  let database: MeshDatabase;
  let store: MeshStore;
  let hub: Hub;
  let service: MeshService | undefined;

  beforeEach(async () => {
    database = await MeshDatabase.open(":memory:");
    store = new MeshStore(database);
    hub = new Hub();
  });

  afterEach(async () => {
    await service?.drainEvents();
    await database.close();
  });

  async function connect(id: string, extra: Parameters<typeof addWorker>[1] extends infer T ? Partial<T> : never = {}) {
    const worker = await addWorker(store, { id, ...extra });
    hub.connected.add(worker.id);
    return worker;
  }

  async function own(identityId: string, accountId: string): Promise<void> {
    const now = Date.now();
    await database.raw.prepare(
      `INSERT INTO node_ownership(identity_kind, identity_id, account_id, credential_fingerprint,
       status, generation, created_at, updated_at) VALUES ('device', ?, ?, ?, 'active', 1, ?, ?)`,
    ).run(identityId, accountId, `sha256:${identityId}`, now, now);
  }

  it("sends parallel pieces to different nodes, then refuses before dispatch when none is left", async () => {
    const workers = await Promise.all(["one", "two", "three"].map((id) => connect(id)));
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    const handles = await Promise.all([1, 2, 3].map((index) => service!.submit(piece(index))));
    const offered = hub.offers().map((offer) => offer.workerId);
    expect(new Set(offered)).toEqual(new Set(workers.map((worker) => worker.id)));
    expect(JSON.stringify(hub.offers())).not.toContain("dispersion");
    const before = hub.sent.length;
    await expect(service.submit(piece(4))).rejects.toThrow(expect.objectContaining({ code: "dispersion_exhausted", statusCode: 503 }));
    expect(hub.sent.length).toBe(before);
    const other = await service.submit(piece(1, "another-recording-abcdef"));
    for (const handle of [...handles, other]) await service.cancel(handle.jobId);
  });

  it("treats nodes of one owner as one party", async () => {
    await connect("mine-a", { identity: { kind: "device", id: "node-mine-a" } });
    await connect("mine-b", { identity: { kind: "device", id: "node-mine-b" } });
    await own("node-mine-a", "owner-1");
    await own("node-mine-b", "owner-1");
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    const first = await service.submit(piece(1));
    await expect(service.submit(piece(2))).rejects.toThrow(expect.objectContaining({ code: "dispersion_exhausted" }));
    await service.cancel(first.jobId);
  });

  it("treats nodes on one public network as one party, but not nodes on private addresses", async () => {
    const a = await connect("home-a");
    const b = await connect("home-b");
    hub.addresses.set(a.id, "198.51.100.10");
    hub.addresses.set(b.id, "198.51.100.11");
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    const first = await service.submit(piece(1));
    await expect(service.submit(piece(2))).rejects.toThrow(expect.objectContaining({ code: "dispersion_exhausted" }));
    await service.cancel(first.jobId);

    hub.addresses.set(a.id, "10.0.0.2");
    hub.addresses.set(b.id, "10.0.0.3");
    const group = "private-network-recording-1";
    const x = await service.submit(piece(1, group));
    const y = await service.submit(piece(2, group));
    const offers = hub.offers().slice(-2).map((offer) => offer.workerId);
    expect(new Set(offers).size).toBe(2);
    await service.cancel(x.jobId);
    await service.cancel(y.jobId);
  });

  it("does not fail over to a standby that has since received another piece", async () => {
    const primary = await connect("primary", { tokensPerSecond: 80, modelDigest: "sha256:same" });
    const standby = await connect("standby", { tokensPerSecond: 40, maxConcurrency: 4, modelDigest: "sha256:same" });
    const third = await connect("third", { tokensPerSecond: 10, modelDigest: "sha256:same" });
    service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
    const first = await service.submit(piece(1));
    const firstOffer = hub.offers().at(-1)!;
    expect(firstOffer.workerId).toBe(primary.id);
    const second = await service.submit(piece(2));
    expect(hub.offers().at(-1)!.workerId).toBe(standby.id);
    const rejection: WorkerEnvelope = {
      v: 1, type: "lease.reject", workerId: primary.id,
      payload: { jobId: first.jobId, leaseId: firstOffer.payload.leaseId, reason: "worker_capacity_exhausted" },
    };
    hub.emit("envelope", rejection);
    await service.drainEvents();
    const firstPieceOffers = hub.offers().filter((offer) => offer.payload.jobId === first.jobId);
    expect(firstPieceOffers.map((offer) => offer.workerId)).toEqual([primary.id, third.id]);
    await service.cancel(first.jobId);
    await service.cancel(second.jobId);
  });
});
