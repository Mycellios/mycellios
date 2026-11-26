import { createHash } from "node:crypto";
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile, utimes } from "node:fs/promises";
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ARTIFACT_SEED_GRANT_SCHEMA,
  ARTIFACT_SEED_OBSERVATION_SCHEMA,
  ARTIFACT_SEED_REQUEST_SCHEMA,
  ARTIFACT_SEED_RESPONSE_SCHEMA,
  artifactSeedInventoryRevision,
  type ArtifactSeedGrant,
} from "../src/contracts/artifact-seed.js";
import { mergeCurrentSessionEvidence } from "../src/coordinator/evidence-authority.js";
import { workerCapabilitiesSchema } from "../src/contracts/schemas.js";
import { nodeConfigurationSchema } from "../src/contracts/node-configuration.js";
import { collectFleetResourceEvidence } from "../src/coordinator/fleet-resource-evidence.js";
import { issueArtifactSeedGrants } from "../src/distribution/artifact-seed-grants.js";
import { fleetArtifactPeerPolicy } from "../src/distribution/fleet-artifact-policy.js";
import { planFleetResourceRoles } from "../src/distribution/fleet-resource-roles.js";
import type { StoredWorker } from "../src/storage/store.js";
import { fetchArtifactSeedBlob } from "../src/worker/artifact-seed-client.js";
import { ArtifactSeedServer, type ArtifactSeedServeOutcome } from "../src/worker/artifact-seed-server.js";
import { ArtifactSeedStore, artifactSeedBlobPath } from "../src/worker/artifact-seed-store.js";
import { withoutDynamicObservations } from "../src/worker/host-memory.js";

const roots: string[] = [];
const servers: Array<{ close(): unknown }> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mycellios-artifact-seed-"));
  roots.push(root);
  return root;
}

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const token = (fill: string) => fill.repeat(43).slice(0, 43);

async function putBlob(casRoot: string, value: Buffer, name = sha256(value)): Promise<string> {
  const path = join(casRoot, "objects", "sha256", name.slice(0, 2), name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, value);
  return name;
}

async function seededStore(options: { quotaBytes?: number; slots?: number; indexPath?: string; casRoot?: string } = {}) {
  const casRoot = options.casRoot ?? join(tempRoot(), "stage-cas");
  const first = Buffer.alloc(300_000, 7);
  const second = Buffer.from("second verified blob");
  const firstDigest = await putBlob(casRoot, first);
  const secondDigest = await putBlob(casRoot, second);
  // Wrong bytes under a digest name, and a file outside the digest layout.
  const corruptDigest = await putBlob(casRoot, Buffer.from("tampered"), sha256(Buffer.from("original")));
  await writeFile(join(casRoot, "objects", "sha256", "README"), "not a blob");
  const store = new ArtifactSeedStore({ casRoot, quotaBytes: options.quotaBytes ?? 10_000_000,
    maxTransferSlots: options.slots ?? 2, verifyBytesPerSecond: 1e12,
    ...(options.indexPath ? { indexPath: options.indexPath } : {}) });
  store.setServicePort(40_000);
  await store.refresh();
  return { casRoot, store, first, second, firstDigest, secondDigest, corruptDigest };
}

function worker(id: string, nodeId: string, overrides: Partial<StoredWorker> = {}, seed?: unknown): StoredWorker {
  return {
    id, status: "online", reliability: 1, jobsCompleted: 0, lastSeenAt: 1_000_000, identityKind: "device", identityId: nodeId,
    capabilities: {
      region: "eu", agentVersion: "1.0.0", deployments: [],
      gpus: [{ id: "gpu-0", vendor: "none", model: "cpu", physicalVramMb: 0, offeredVramMb: 512, freeOfferedVramMb: 512 }],
      limits: { maxConcurrency: 1, pauseWhenForeground: false },
      network: { coordinatorRttMs: 10, uplinkMbps: 10, downlinkMbps: 10 },
      distributedExecutor: { protocol: "gdlp-worker-tunnel/2", nodeId, stageHost: "127.0.0.1", stagePort: 9000,
        runtime: "python-safetensors", computeMode: "cpu-only", cpuEligible: false },
      ...(seed === undefined ? {} : { artifactSeed: seed }),
    } as unknown as StoredWorker["capabilities"],
    ...overrides,
  };
}

function seedObservation(digests: string[], observedAt = 1_000, slots = 2) {
  return { schema: ARTIFACT_SEED_OBSERVATION_SCHEMA, ready: true, inventoryRevision: artifactSeedInventoryRevision(digests),
    verifiedBlobSha256s: digests, freeTransferSlots: slots, quotaBytes: 10_000_000, heldBytes: 1_000, servicePort: 40_000,
    observedAt };
}

describe("artifact seed reporting", () => {
  it("offers only hash-verified blobs within the owner quota, in stable order", async () => {
    const { store, firstDigest, secondDigest, corruptDigest } = await seededStore();
    const observation = store.observe(true);
    expect(observation.ready).toBe(true);
    expect(observation.verifiedBlobSha256s).toEqual([firstDigest, secondDigest].sort());
    expect(observation.verifiedBlobSha256s).not.toContain(corruptDigest);
    expect(observation.freeTransferSlots).toBe(2);
    expect(observation.heldBytes).toBe(300_000 + 20);

    const tight = await seededStore({ quotaBytes: 100 });
    expect(tight.store.observe(true).verifiedBlobSha256s).toEqual([tight.secondDigest]);
    expect(tight.store.observe(true).heldBytes).toBe(20);
  });

  it("reports nothing while paused and counts reserved transfer slots", async () => {
    const { store } = await seededStore({ slots: 1 });
    expect(store.observe(false)).toMatchObject({ ready: false, verifiedBlobSha256s: [], freeTransferSlots: 0 });
    const release = store.acquireSlot();
    expect(release).not.toBeNull();
    expect(store.acquireSlot()).toBeNull();
    expect(store.observe(true).freeTransferSlots).toBe(0);
    release!();
    release!();
    expect(store.observe(true).freeTransferSlots).toBe(1);
  });

  it("is not ready before its first verification pass or without a service port", async () => {
    const store = new ArtifactSeedStore({ casRoot: join(tempRoot(), "stage-cas"), quotaBytes: 1, maxTransferSlots: 1 });
    store.setServicePort(40_000);
    expect(store.observe(true).ready).toBe(false);
    const unlistened = new ArtifactSeedStore({ casRoot: join(tempRoot(), "stage-cas"), quotaBytes: 1, maxTransferSlots: 1 });
    await unlistened.refresh();
    expect(unlistened.observe(true).ready).toBe(false);
  });

  it("sends the digest list only on change or after the refresh period", async () => {
    let clock = 1_000_000;
    const casRoot = join(tempRoot(), "stage-cas");
    const digest = await putBlob(casRoot, Buffer.from("delta blob"));
    const store = new ArtifactSeedStore({ casRoot, quotaBytes: 1_000, maxTransferSlots: 1, verifyBytesPerSecond: 1e12,
      fullObservationEveryMs: 60_000, now: () => clock });
    store.setServicePort(40_000);
    await store.refresh();
    const full = store.observe(true);
    expect(full.verifiedBlobSha256s).toEqual([digest]);
    clock += 5_000;
    const delta = store.observe(true);
    expect(delta.verifiedBlobSha256s).toBeUndefined();
    expect(delta.inventoryRevision).toBe(full.inventoryRevision);
    clock += 60_000;
    expect(store.observe(true).verifiedBlobSha256s).toEqual([digest]);
    clock += 1_000;
    // Pausing changes the advertised inventory, so the empty list is sent at once.
    expect(store.observe(false).verifiedBlobSha256s).toEqual([]);

    // The coordinator keeps a list only for the exact same revision.
    const current = worker("w", "seed-node", {}, full).capabilities;
    const merged = mergeCurrentSessionEvidence("w", "s", worker("w", "seed-node", {}, delta).capabilities, current);
    expect(merged.artifactSeed?.verifiedBlobSha256s).toEqual([digest]);
    const changed = { ...delta, inventoryRevision: artifactSeedInventoryRevision(["e".repeat(64)]) };
    const unmerged = mergeCurrentSessionEvidence("w", "s", worker("w", "seed-node", {}, changed).capabilities, current);
    expect(unmerged.artifactSeed?.verifiedBlobSha256s).toBeUndefined();
  });

  it("reuses a persisted verification index only for unchanged files", async () => {
    const root = tempRoot();
    const indexPath = join(root, "artifact-seed-index.json");
    const casRoot = join(root, "stage-cas");
    const first = await seededStore({ casRoot, indexPath });
    const index = JSON.parse(readFileSync(indexPath, "utf8")) as { entries: Array<{ digest: string }> };
    expect(index.entries.map(entry => entry.digest).sort()).toEqual([first.firstDigest, first.secondDigest].sort());
    expect(readFileSync(indexPath, "utf8")).not.toContain(casRoot);
    // Same bytes on disk, but a restart must not trust an index entry whose
    // file identity changed: rewrite the blob with wrong bytes, same name.
    await writeFile(artifactSeedBlobPath(casRoot, first.secondDigest), "rewritten");
    const restarted = new ArtifactSeedStore({ casRoot, quotaBytes: 10_000_000, maxTransferSlots: 1,
      verifyBytesPerSecond: 1e12, indexPath });
    restarted.setServicePort(40_000);
    await restarted.refresh();
    expect(restarted.observe(true).verifiedBlobSha256s).toEqual([first.firstDigest]);
  });

  it("withdraws a blob whose file changed after verification", async () => {
    const { store, casRoot, secondDigest } = await seededStore();
    await utimes(artifactSeedBlobPath(casRoot, secondDigest), new Date(1_000), new Date(1_000));
    await expect(store.openVerified(secondDigest)).rejects.toThrow("artifact_seed_blob_changed");
    expect(store.offers(secondDigest)).toBe(false);
  });

  it("travels in heartbeat capabilities but never in the signed registration", () => {
    const observation = seedObservation(["a".repeat(64)]);
    const base = worker("w", "seed-node", {}, observation).capabilities;
    expect(workerCapabilitiesSchema.parse(base).artifactSeed).toEqual(observation);
    expect(workerCapabilitiesSchema.safeParse({ ...base, artifactSeed: { ...observation, ready: false } }).success).toBe(false);
    expect(workerCapabilitiesSchema.safeParse({ ...base, artifactSeed: { ...observation, heldBytes: 20_000_000 } }).success).toBe(false);
    expect("artifactSeed" in withoutDynamicObservations(base)).toBe(false);
  });

  it("keeps the node configuration opt-in bounded", () => {
    const shape = nodeConfigurationSchema.shape.artifactSeed;
    expect(shape.safeParse(undefined).success).toBe(true);
    expect(shape.safeParse({ enabled: true, diskQuotaMiB: 20_000, maxTransferSlots: 1, maxUploadMbps: 20 }).success).toBe(true);
    expect(shape.safeParse({ enabled: true, diskQuotaMiB: 20_000, maxTransferSlots: 8, maxUploadMbps: 20 }).success).toBe(false);
  });
});

describe("coordinator ingestion and planning", () => {
  const nowMs = 1_000_000;
  const blob = "b".repeat(64);

  it("turns fresh heartbeat observations into planner seed evidence", () => {
    const evidence = collectFleetResourceEvidence({
      nowMs, connectedWorkerIds: new Set(["w-seed", "w-paused", "w-stale"]),
      devices: [{ id: "gpu-node", connected: true }],
      workers: [
        worker("w-gpu", "gpu-node"),
        worker("w-seed", "seed-node", {}, seedObservation([blob])),
        worker("w-paused", "paused-node", { status: "draining" }, seedObservation([blob])),
        worker("w-stale", "stale-node", {}, seedObservation([blob], 700)),
        worker("w-gone", "gone-node", { status: "offline" }, seedObservation([blob])),
        worker("w-old", "seed-node", { lastSeenAt: 10 }, seedObservation(["c".repeat(64)])),
      ],
    });
    const byId = new Map(evidence.nodes.map(node => [node.nodeId, node]));
    expect(evidence.nodes.map(node => node.nodeId)).toEqual(["gpu-node", "gone-node", "paused-node", "seed-node", "stale-node"]);
    expect(byId.get("gpu-node")).toEqual({ nodeId: "gpu-node", connected: true, enabled: true, observedAtMs: nowMs });
    expect(byId.get("seed-node")).toMatchObject({ connected: true, enabled: true,
      seed: { ready: true, verifiedBlobSha256s: [blob], freeTransferSlots: 2 } });
    expect(byId.get("paused-node")).toMatchObject({ enabled: false, seed: { ready: false } });
    expect(byId.get("stale-node")?.seed).toBeUndefined();
    expect(byId.get("gone-node")?.connected).toBe(false);
  });

  it("assigns a reporting seed and grants exactly the planned transfer", () => {
    const evidence = collectFleetResourceEvidence({
      nowMs, connectedWorkerIds: new Set(["w-gpu", "w-req", "w-seed"]),
      devices: [{ id: "gpu-node", connected: true }],
      workers: [worker("w-gpu", "gpu-node"), worker("w-req", "requester-node"),
        worker("w-seed", "seed-node", {}, seedObservation([blob]))],
      demands: [{ requestId: "transfer-1", requesterNodeId: "requester-node", blobSha256: blob, sizeBytes: 100_000_000,
        originExpectedMs: 60_000, peers: [{ nodeId: "seed-node", measuredAtMs: nowMs, rttMs: 5, goodputMbps: 100 }] }],
    });
    const plan = planFleetResourceRoles(["gpu-node"], evidence, nowMs);
    expect(plan.assignments.find(node => node.nodeId === "seed-node")).toMatchObject({
      role: "artifact-seed", transferRequestIds: ["transfer-1"] });
    expect(plan.assignments.find(node => node.nodeId === "gpu-node")?.role).toBe("inference");
    expect(fleetArtifactPeerPolicy(plan, "requester-node", () => nowMs)("seed-node", blob)).toBe(true);

    const grants = issueArtifactSeedGrants(plan, { now: nowMs + 1_000, randomToken: () => token("t") });
    expect(grants).toEqual([{ schema: ARTIFACT_SEED_GRANT_SCHEMA, transferId: "transfer-1", sourceNodeId: "seed-node",
      requesterNodeId: "requester-node", blobSha256: blob, sizeBytes: 100_000_000, expiresAtMs: nowMs + 61_000,
      token: token("t") }]);
    expect(issueArtifactSeedGrants(plan, { now: nowMs + 100_000, randomToken: () => token("t") })[0]!.expiresAtMs)
      .toBe(nowMs + 120_000);
    expect(issueArtifactSeedGrants(plan, { now: nowMs + 120_000 })).toEqual([]);
  });

  it("assigns no seed without a fresh observation or a free slot", () => {
    for (const seed of [seedObservation([blob], 500), seedObservation([blob], 1_000, 0)]) {
      const evidence = collectFleetResourceEvidence({
        nowMs, connectedWorkerIds: new Set(["w-req", "w-seed"]),
        workers: [worker("w-req", "requester-node"), worker("w-seed", "seed-node", {}, seed)],
        demands: [{ requestId: "t", requesterNodeId: "requester-node", blobSha256: blob, sizeBytes: 1_000_000,
          originExpectedMs: 60_000, peers: [{ nodeId: "seed-node", measuredAtMs: nowMs, rttMs: 5, goodputMbps: 100 }] }],
      });
      const plan = planFleetResourceRoles([], evidence, nowMs);
      expect(plan.transfers).toEqual([]);
      expect(plan.assignments.find(node => node.nodeId === "seed-node")?.role).toBe("available");
    }
  });
});

describe("seed serving", () => {
  async function servingFixture() {
    const seeded = await seededStore();
    let clock = 5_000_000;
    let enabled = true;
    const outcomes: ArtifactSeedServeOutcome[] = [];
    const server = new ArtifactSeedServer({ nodeId: "seed-node", store: seeded.store, enabled: () => enabled,
      maxUploadBytesPerSecond: 1e12, now: () => clock, onOutcome: outcome => outcomes.push(outcome) });
    servers.push(server);
    const port = await server.listenLoopback();
    const grant = (overrides: Partial<ArtifactSeedGrant> = {}): ArtifactSeedGrant => ({
      schema: ARTIFACT_SEED_GRANT_SCHEMA, transferId: "transfer-1", sourceNodeId: "seed-node",
      requesterNodeId: "requester-node", blobSha256: seeded.firstDigest, sizeBytes: seeded.first.byteLength,
      expiresAtMs: clock + 60_000, token: token("s"), ...overrides,
    });
    let streams = 0;
    // Stands in for the tunnel: the coordinator binds the stream to the
    // requester it authenticated, then the loopback connection is attached.
    const dial = async (bindAs: string | null = "requester-node"): Promise<Socket> => {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const value = connect(port, "127.0.0.1", () => resolve(value));
        value.once("error", reject);
      });
      if (bindAs !== null) {
        const streamId = `stream-${streams++}`;
        server.bindStream(streamId, bindAs, clock + 60_000);
        server.attachIncoming(streamId, socket.localPort);
      }
      return socket;
    };
    return { ...seeded, server, port, grant, outcomes, dial,
      tick: (ms: number) => { clock += ms; }, pause: () => { enabled = false; } };
  }

  async function rawRequest(fixture: { dial(bindAs?: string | null): Promise<Socket> }, request: Record<string, unknown>,
    bindAs: string | null = "requester-node"): Promise<Record<string, unknown>> {
    const socket = await fixture.dial(bindAs);
    socket.write(`${JSON.stringify({ schema: ARTIFACT_SEED_REQUEST_SCHEMA, ...request })}\n`);
    const chunks: Buffer[] = [];
    for await (const chunk of socket) { chunks.push(chunk as Buffer); if (Buffer.concat(chunks).includes(0x0a)) break; }
    socket.destroy();
    const body = Buffer.concat(chunks);
    return JSON.parse(body.subarray(0, body.indexOf(0x0a)).toString("utf8")) as Record<string, unknown>;
  }

  const requestFor = (grant: ArtifactSeedGrant) => ({ transferId: grant.transferId,
    requesterNodeId: grant.requesterNodeId, blobSha256: grant.blobSha256, token: grant.token });

  it("streams a verified blob that the requester re-verifies and publishes", async () => {
    const fixture = await servingFixture();
    const grant = fixture.grant();
    fixture.server.admitGrant(grant);
    const requesterCas = join(tempRoot(), "stage-cas");
    const result = await fetchArtifactSeedBlob(await fixture.dial(),
      { grant, requesterNodeId: "requester-node", casRoot: requesterCas, now: () => 5_000_000 });
    expect(result).toEqual({ path: artifactSeedBlobPath(requesterCas, fixture.firstDigest),
      sizeBytes: fixture.first.byteLength, published: true });
    expect(sha256(readFileSync(result.path))).toBe(fixture.firstDigest);
    expect(statSync(result.path).size).toBe(fixture.first.byteLength);
    expect(readdirSync(join(requesterCas, "partials", "artifact-seed"))).toEqual([]);
    expect(fixture.outcomes).toEqual([{ ok: true, bytesSent: fixture.first.byteLength, transferId: "transfer-1" }]);
    // Single use: the same grant cannot be replayed.
    expect(await rawRequest(fixture, requestFor(grant))).toMatchObject({ ok: false, code: "artifact_seed_grant_unknown" });
  });

  it("requires the coordinator-authenticated requester, not only the token", async () => {
    const fixture = await servingFixture();
    const grant = fixture.grant();
    fixture.server.admitGrant(grant);
    // No coordinator binding for this connection: the token alone is not enough.
    expect((await rawRequest(fixture, requestFor(grant), null)).code).toBe("artifact_seed_stream_unbound");
    // The coordinator authenticated a different node as the stream source.
    expect((await rawRequest(fixture, requestFor(grant), "other-node")).code).toBe("artifact_seed_requester_mismatch");
    // A binding is one-shot and the grant survives refused attempts.
    expect((await rawRequest(fixture, requestFor(grant))).ok).toBe(true);
  });

  it("rejects a wrong requester, blob, token, expired or paused grant", async () => {
    const fixture = await servingFixture();
    const grant = fixture.grant();
    fixture.server.admitGrant(grant);
    const refused = async (request: Record<string, unknown>) =>
      (await rawRequest(fixture, { ...requestFor(grant), ...request })).code;
    expect(await refused({ requesterNodeId: "other-node" })).toBe("artifact_seed_requester_mismatch");
    expect(await refused({ blobSha256: fixture.secondDigest })).toBe("artifact_seed_blob_mismatch");
    expect(await refused({ token: token("x") })).toBe("artifact_seed_token_invalid");
    expect(await refused({ transferId: "unplanned" })).toBe("artifact_seed_grant_unknown");
    expect(await refused({ token: "short" })).toBe("artifact_seed_request_invalid");
    fixture.tick(60_000);
    expect(await refused({})).toBe("artifact_seed_grant_expired");

    fixture.server.admitGrant(fixture.grant({ transferId: "transfer-2" }));
    fixture.pause();
    expect(await refused({ transferId: "transfer-2" })).toBe("artifact_seed_paused");
    expect(fixture.outcomes.every(outcome => !outcome.ok && outcome.bytesSent === 0)).toBe(true);
    expect(JSON.stringify(fixture.outcomes)).not.toContain(grant.token);
  });

  it("admits only grants for this source within the plan window", async () => {
    const fixture = await servingFixture();
    expect(() => fixture.server.admitGrant(fixture.grant({ sourceNodeId: "another-seed" })))
      .toThrow("artifact_seed_grant_wrong_source");
    expect(() => fixture.server.admitGrant(fixture.grant({ expiresAtMs: 5_000_000 + 200_000 })))
      .toThrow("artifact_seed_grant_expired");
    expect(() => fixture.server.admitGrant(fixture.grant({ expiresAtMs: 4_000_000 })))
      .toThrow("artifact_seed_grant_expired");
    fixture.server.admitGrant(fixture.grant());
    expect(() => fixture.server.admitGrant(fixture.grant())).toThrow("artifact_seed_grant_duplicate");
    fixture.server.revokeAll();
    expect(fixture.server.pendingGrants).toBe(0);
  });

  it("refuses a blob the seed does not offer", async () => {
    const fixture = await servingFixture();
    const missing = fixture.grant({ transferId: "missing", blobSha256: "d".repeat(64) });
    fixture.server.admitGrant(missing);
    expect((await rawRequest(fixture, requestFor(missing))).code).toBe("artifact_seed_blob_unavailable");
  });
});

describe("requester verification", () => {
  async function maliciousSeed(payload: Buffer, sizeBytes: number, blobSha256: string): Promise<number> {
    const server: Server = createServer((socket) => {
      socket.once("data", () => {
        socket.write(`${JSON.stringify({ schema: ARTIFACT_SEED_RESPONSE_SCHEMA, ok: true, blobSha256, sizeBytes })}\n`);
        socket.end(payload);
      });
    });
    servers.push({ close: () => new Promise<void>(resolve => server.close(() => resolve())) });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    return (server.address() as AddressInfo).port;
  }

  const expected = Buffer.from("the real weights");
  const grant = (overrides: Partial<ArtifactSeedGrant> = {}): ArtifactSeedGrant => ({
    schema: ARTIFACT_SEED_GRANT_SCHEMA, transferId: "t", sourceNodeId: "seed-node", requesterNodeId: "requester-node",
    blobSha256: sha256(expected), sizeBytes: expected.byteLength, expiresAtMs: Date.now() + 60_000, token: token("q"),
    ...overrides,
  });

  async function fetchFrom(port: number, value: ArtifactSeedGrant, casRoot: string) {
    const socket = await new Promise<Socket>((resolve) => { const s = connect(port, "127.0.0.1", () => resolve(s)); });
    return await fetchArtifactSeedBlob(socket, { grant: value, requesterNodeId: "requester-node", casRoot });
  }

  it.each([
    ["artifact_seed_digest_mismatch", Buffer.from("the fake weights")],
    ["artifact_seed_oversize", Buffer.from("the real weights plus more")],
    ["artifact_seed_truncated", Buffer.from("the real")],
  ])("rejects %s without publishing anything", async (code, payload) => {
    const casRoot = join(tempRoot(), "stage-cas");
    const port = await maliciousSeed(payload, expected.byteLength, sha256(expected));
    await expect(fetchFrom(port, grant(), casRoot)).rejects.toThrow(code);
    expect(existsSync(artifactSeedBlobPath(casRoot, sha256(expected)))).toBe(false);
    const partial = join(casRoot, "partials", "artifact-seed");
    expect(existsSync(partial) ? readdirSync(partial) : []).toEqual([]);
  });

  it("rejects a response announcing another blob or size", async () => {
    const casRoot = join(tempRoot(), "stage-cas");
    const port = await maliciousSeed(expected, expected.byteLength + 1, sha256(expected));
    await expect(fetchFrom(port, grant(), casRoot)).rejects.toThrow("artifact_seed_response_mismatch");
  });

  it("refuses a grant for another requester or one already expired", async () => {
    const casRoot = join(tempRoot(), "stage-cas");
    const port = await maliciousSeed(expected, expected.byteLength, sha256(expected));
    await expect(fetchFrom(port, grant({ requesterNodeId: "other-node" }), casRoot))
      .rejects.toThrow("artifact_seed_grant_wrong_requester");
    await expect(fetchFrom(port, grant({ expiresAtMs: Date.now() - 1 }), casRoot))
      .rejects.toThrow("artifact_seed_grant_expired");
  });
});
