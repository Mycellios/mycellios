import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { sealedLeaseSchema, sealingAnnouncementSchema } from "../src/contracts/sealed-lease.js";
import type { ChatCompletionRequest, JobPayload } from "../src/contracts/types.js";
import { workerHelloEnvelopeSchema } from "../src/contracts/worker-protocol.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import {
  generateSealingKeyPair,
  openLeaseRequest,
  sealLeaseRequest,
  SealedLeaseError,
} from "../src/transport/sealed-lease.js";
import { parseServerMessage } from "../src/worker/agent.js";
import { leaseOfferJob, sealingHello } from "../src/worker/sealed-lease-offer.js";
import { addWorker } from "./helpers.js";

const binding = { jobId: "job_1", leaseId: "lea_1", modelDigest: "sha256:model", deadlineAt: 1_900_000_000_000 };
const request: ChatCompletionRequest = { model: "distributed-small", messages: [{ role: "user", content: "my private note" }] };

describe("sealed lease cryptography (specs/node-owner-privacy D4)", () => {
  it("opens only with the announced key and the exact lease binding", () => {
    const worker = generateSealingKeyPair();
    const sealed = sealLeaseRequest(request, worker.announcement.publicKey, binding);
    expect(sealedLeaseSchema.parse(sealed)).toEqual(sealed);
    expect(JSON.stringify(sealed)).not.toContain("private note");
    expect(openLeaseRequest(sealed, worker.privateKey, worker.announcement.publicKey, binding)).toEqual(request);

    for (const changed of [
      { ...binding, jobId: "job_2" },
      { ...binding, leaseId: "lea_2" },
      { ...binding, modelDigest: "sha256:other" },
      { ...binding, deadlineAt: binding.deadlineAt + 1 },
    ]) {
      expect(() => openLeaseRequest(sealed, worker.privateKey, worker.announcement.publicKey, changed)).toThrow(SealedLeaseError);
    }
    const other = generateSealingKeyPair();
    expect(() => openLeaseRequest(sealed, other.privateKey, other.announcement.publicKey, binding)).toThrow(SealedLeaseError);
  });

  it("rejects tampered ciphertext, nonce and ephemeral key", () => {
    const worker = generateSealingKeyPair();
    const sealed = sealLeaseRequest(request, worker.announcement.publicKey, binding);
    const flip = (value: string) => {
      const bytes = Buffer.from(value, "base64url");
      bytes[0]! ^= 1;
      return bytes.toString("base64url");
    };
    for (const tampered of [
      { ...sealed, ciphertext: flip(sealed.ciphertext) },
      { ...sealed, nonce: flip(sealed.nonce) },
      { ...sealed, ephemeralPublicKey: generateSealingKeyPair().announcement.publicKey },
    ]) {
      expect(() => openLeaseRequest(tampered, worker.privateKey, worker.announcement.publicKey, binding)).toThrow(SealedLeaseError);
    }
  });

  it("uses a fresh ephemeral key and nonce for every lease", () => {
    const worker = generateSealingKeyPair();
    const first = sealLeaseRequest(request, worker.announcement.publicKey, binding);
    const second = sealLeaseRequest(request, worker.announcement.publicKey, binding);
    expect(first.ephemeralPublicKey).not.toBe(second.ephemeralPublicKey);
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("refuses a small-order or malformed recipient key", () => {
    expect(() => sealLeaseRequest(request, "A".repeat(43), binding)).toThrow(SealedLeaseError);
    expect(() => sealLeaseRequest(request, "not-a-key", binding)).toThrow(SealedLeaseError);
  });

  it("keeps a 1 MiB request well inside the worker's message limit", () => {
    const worker = generateSealingKeyPair();
    const large = { ...request, messages: [{ role: "user" as const, content: "x".repeat(1024 * 1024) }] };
    const sealed = sealLeaseRequest(large, worker.announcement.publicKey, binding);
    expect(Buffer.byteLength(JSON.stringify({ v: 1, type: "lease.offer", payload: { ...binding, sealed } }))).toBeLessThan(2 * 1024 * 1024);
  });
});

describe("worker side", () => {
  it("announces a key only to a coordinator that advertised sealed leases", () => {
    expect(sealingHello(false)).toEqual({ key: null, hello: {} });
    const { key, hello } = sealingHello(true);
    expect(key).not.toBeNull();
    expect(workerHelloEnvelopeSchema.parse({ v: 1, type: "worker.hello", workerId: "w", payload: hello })).toBeTruthy();
    expect(sealingAnnouncementSchema.parse((hello as { sealing: unknown }).sealing)).toMatchObject({ publicKey: key!.publicKey });
    expect(workerHelloEnvelopeSchema.safeParse({ v: 1, type: "worker.hello", workerId: "w", payload: { sealing: { version: 1, publicKey: "short" } } }).success).toBe(false);
    expect(workerHelloEnvelopeSchema.safeParse({ v: 1, type: "worker.hello", workerId: "w", payload: {} }).success).toBe(true);
  });

  it("opens a sealed offer in memory and rejects what it cannot open", () => {
    const { key } = sealingHello(true);
    const sealed = sealLeaseRequest(request, key!.publicKey, binding);
    const offer = parseServerMessage({ v: 1, type: "lease.offer", payload: { ...binding, sealed } });
    expect(offer.type).toBe("lease.offer");
    const job = leaseOfferJob((offer as { payload: Parameters<typeof leaseOfferJob>[0] }).payload, key);
    expect(job).toMatchObject({ ...binding, request: { model: request.model, messages: request.messages } });
    expect(() => leaseOfferJob({ ...binding, sealed }, null)).toThrow(SealedLeaseError);
    expect(() => leaseOfferJob({ ...binding, sealed }, sealingHello(true).key)).toThrow(SealedLeaseError);
    const invalid = sealLeaseRequest({ model: "" }, key!.publicKey, binding);
    expect(() => leaseOfferJob({ ...binding, sealed: invalid }, key)).toThrow(SealedLeaseError);
    expect(leaseOfferJob({ ...binding, request }, null)).toEqual({ ...binding, request });
  });

  it("accepts exactly one of a plaintext or a sealed request", () => {
    const { key } = sealingHello(true);
    const sealed = sealLeaseRequest(request, key!.publicKey, binding);
    expect(() => parseServerMessage({ v: 1, type: "lease.offer", payload: { ...binding, request, sealed } })).toThrow();
    expect(() => parseServerMessage({ v: 1, type: "lease.offer", payload: { ...binding } })).toThrow();
    expect(parseServerMessage({ v: 1, type: "lease.offer", payload: { ...binding, request } }).type).toBe("lease.offer");
  });
});

describe("coordinator offers", () => {
  class Hub extends EventEmitter {
    readonly connected = new Set<string>();
    readonly keys = new Map<string, string>();
    readonly sent: Array<{ workerId: string; type: string; payload: unknown }> = [];
    connectedWorkerIds(): ReadonlySet<string> { return new Set(this.connected); }
    isConnected(workerId: string): boolean { return this.connected.has(workerId); }
    workerSealingKey(workerId: string): string | null { return this.keys.get(workerId) ?? null; }
    send(workerId: string, type: string, payload: unknown): boolean {
      this.sent.push({ workerId, type, payload });
      return this.isConnected(workerId);
    }
  }

  it("seals the request for a worker that announced a key and keeps plaintext for one that did not", async () => {
    const database = await MeshDatabase.open(":memory:");
    try {
      const store = new MeshStore(database);
      const hub = new Hub();
      const sealing = generateSealingKeyPair();
      const modern = await addWorker(store, { id: "modern", tokensPerSecond: 50 });
      hub.connected.add(modern.id);
      hub.keys.set(modern.id, sealing.announcement.publicKey);
      const service = await MeshService.create(store, new Scheduler(store), hub as unknown as WorkerHub, 30_000);
      const sealedHandle = await service.submit({ ...request, messages: [{ role: "user", content: "sealed secret" }] });
      const sealedOffer = hub.sent.find((message) => message.type === "lease.offer")!.payload as Omit<JobPayload, "request"> & { sealed: never };
      expect(sealedOffer).not.toHaveProperty("request");
      expect(JSON.stringify(sealedOffer)).not.toContain("sealed secret");
      const opened = leaseOfferJob(sealedOffer, { privateKey: sealing.privateKey, publicKey: sealing.announcement.publicKey });
      expect(opened.request.messages).toEqual([{ role: "user", content: "sealed secret" }]);
      await service.cancel(sealedHandle.jobId);

      hub.keys.delete(modern.id);
      hub.sent.length = 0;
      const plainHandle = await service.submit({ ...request, messages: [{ role: "user", content: "older worker" }] });
      const plainOffer = hub.sent.find((message) => message.type === "lease.offer")!.payload as JobPayload;
      expect(plainOffer.request.messages[0]!.content).toBe("older worker");
      await service.cancel(plainHandle.jobId);
      await service.drainEvents();
    } finally {
      await database.close();
    }
  });
});
