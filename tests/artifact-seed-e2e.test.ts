/**
 * Single-host integration of the seed path: the real WorkerHub (with its
 * artifact-seed broker and direct-transport negotiation), two real
 * runtime-stream tunnels, a real seed server and requester client. This is
 * loopback evidence only, never multi-host evidence.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeLinkObservation } from "../src/contracts/runtime-link-observations.js";
import type { WorkerEnvelope } from "../src/contracts/types.js";
import { ArtifactSeedBroker } from "../src/coordinator/artifact-seed-broker.js";
import { WorkerHub } from "../src/coordinator/worker-hub.js";
import type { MeshStore, StoredWorker } from "../src/storage/store.js";
import { ARTIFACT_SEED_ENDPOINT_TOKEN_HEADER, ArtifactSeedPeer } from "../src/worker/artifact-seed-peer.js";
import { ArtifactSeedStore, artifactSeedBlobPath } from "../src/worker/artifact-seed-store.js";
import { RuntimeStreamTunnel, type RuntimeStreamServerMessage } from "../src/worker/runtime-stream-tunnel.js";

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const BLOB = Buffer.alloc(300_000, 3);
const DIGEST = sha256(BLOB);

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "mycellios-seed-e2e-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function worker(id: string, nodeId: string, seed: unknown, directTransport?: unknown): StoredWorker {
  return {
    id, status: "online", reliability: 1, jobsCompleted: 0, lastSeenAt: Date.now(), identityKind: "device", identityId: nodeId,
    capabilities: {
      region: "eu", agentVersion: "1.0.0", deployments: [],
      gpus: [{ id: "gpu-0", vendor: "none", model: "cpu", physicalVramMb: 0, offeredVramMb: 512, freeOfferedVramMb: 512 }],
      limits: { maxConcurrency: 1, pauseWhenForeground: false },
      network: { coordinatorRttMs: 10, uplinkMbps: 10, downlinkMbps: 10 },
      distributedExecutor: { protocol: "gdlp-worker-tunnel/2", streamRecovery: "offset-ack-v1", nodeId,
        stageHost: `${nodeId}.relay`, stagePort: 9000, runtime: "python-safetensors", computeMode: "gpu-only",
        cpuEligible: false, ...(directTransport ? { directTransport } : {}) },
      artifactSeed: seed,
    } as unknown as StoredWorker["capabilities"],
  };
}

function directLink(from: string, to: string, measuredAt = Date.now() - 1_000): RuntimeLinkObservation {
  return { fromNodeId: from, toNodeId: to, measuredAt, validUntil: measuredAt + 300_000, rttP50Ms: 5, rttP95Ms: 8,
    jitterP95Ms: 1, goodputMbpsP50: 500, successfulSamples: 4, failedSamples: 0, availability: 1, confidence: 1,
    transportMode: "direct" };
}

/** `direct`: working direct channel, dead candidate (negotiation fails) or none advertised. */
async function network(options: { links?: RuntimeLinkObservation[]; direct?: "working" | "unreachable" | "absent" } = {}) {
  const seedCas = join(tempRoot(), "stage-cas");
  await mkdir(join(seedCas, "objects", "sha256", DIGEST.slice(0, 2)), { recursive: true });
  await writeFile(join(seedCas, "objects", "sha256", DIGEST.slice(0, 2), DIGEST), BLOB);
  const requesterCas = join(tempRoot(), "stage-cas");
  const store = new ArtifactSeedStore({ casRoot: seedCas, quotaBytes: 10_000_000, maxTransferSlots: 1, verifyBytesPerSecond: 1e12 });
  await store.refresh();
  const seedPeer = new ArtifactSeedPeer({ nodeId: "seed-node", casRoot: seedCas, seed: { store, maxUploadBytesPerSecond: 1e12 } });
  const requesterPeer = new ArtifactSeedPeer({ nodeId: "requester-node", casRoot: requesterCas, demandTimeoutMs: 5_000 });
  await seedPeer.start();
  cleanup.push(() => seedPeer.close(), () => requesterPeer.close());

  const peers = new Map([["w-seed", seedPeer], ["w-req", requesterPeer]]);
  const tunnels = new Map<string, RuntimeStreamTunnel>();
  const sent: Array<{ workerId: string; type: string }> = [];
  const workers: StoredWorker[] = [];
  let hub!: WorkerHub;
  // Worker to coordinator, through the hub's real handlers.
  const fromWorker = (workerId: string, type: string, payload: unknown) => {
    sent.push({ workerId, type });
    queueMicrotask(() => {
      const envelope = { v: 1, workerId, type, payload } as WorkerEnvelope;
      const internal = hub as unknown as {
        handleRuntimeStreamEnvelope(envelope: WorkerEnvelope): Promise<void>;
        handleRuntimeDirectEnvelope(envelope: WorkerEnvelope): Promise<void>;
      };
      if (type.startsWith("artifact.seed.")) void hub.artifactSeeds.handle(workerId, type, payload);
      else if (type.startsWith("runtime.direct.")) void internal.handleRuntimeDirectEnvelope(envelope);
      else void internal.handleRuntimeStreamEnvelope(envelope);
    });
    return true;
  };
  const advertisements = new Map<string, unknown>();
  for (const [workerId, nodeId] of [["w-seed", "seed-node"], ["w-req", "requester-node"]] as const) {
    const tunnel = new RuntimeStreamTunnel(nodeId, (type, payload) => fromWorker(workerId, type, payload), {
      directTransport: { listenHost: "127.0.0.1", candidateHosts: ["127.0.0.1"], connectTimeoutMs: 500 },
    });
    tunnels.set(workerId, tunnel);
    cleanup.push(() => tunnel.close());
    advertisements.set(workerId, await tunnel.startDirectTransport());
    peers.get(workerId)!.attach({ send: (type, payload) => fromWorker(workerId, type, payload), tunnel });
  }
  const seedDirect = options.direct === "absent" ? undefined
    : options.direct === "unreachable"
      ? { ...advertisements.get("w-seed") as object, candidates: [{ host: "127.0.0.1", port: await unusedPort(), scope: "configured" }] }
      : advertisements.get("w-seed");
  workers.push(worker("w-seed", "seed-node", seedPeer.observe(true), seedDirect),
    worker("w-req", "requester-node", requesterPeer.observe(true), advertisements.get("w-req")));
  hub = await WorkerHub.create({
    getWorker: (id: string) => workers.find(entry => entry.id === id),
    listWorkers: () => workers,
    listRuntimeLinkSamples: () => [],
    saveRuntimeLinkSample: () => undefined,
  } as unknown as MeshStore);
  vi.spyOn(hub, "isConnected").mockReturnValue(true);
  vi.spyOn(hub, "connectedWorkerIds").mockReturnValue(new Set(["w-seed", "w-req"]));
  vi.spyOn(hub, "runtimeLinkObservations").mockImplementation(() => options.links ?? [directLink("seed-node", "requester-node")]);
  vi.spyOn(hub, "send").mockImplementation((workerId, type, payload) => {
    sent.push({ workerId, type });
    queueMicrotask(() => {
      if (type.startsWith("artifact.seed.")) peers.get(workerId)?.handle({ type, payload });
      else void tunnels.get(workerId)?.handle({ type, payload } as RuntimeStreamServerMessage);
    });
    return true;
  });
  cleanup.push(() => hub.artifactSeeds.close());
  for (const entry of workers) hub.artifactSeeds.observeHeartbeat(entry.id, `session-${entry.id}`, entry.capabilities, "online");
  await new Promise(resolve => setTimeout(resolve, 10));
  return { hub, seedPeer, requesterPeer, requesterCas, workers, sent, tunnels };
}

describe("artifact seed end to end on one host", () => {
  it("binds the authenticated requester and publishes a verified blob over the direct channel", async () => {
    const net = await network();
    const outcome = await net.requesterPeer.requestBlob(DIGEST, BLOB.byteLength);
    expect(outcome).toEqual({ ok: true, published: true });
    expect(sha256(readFileSync(artifactSeedBlobPath(net.requesterCas, DIGEST)))).toBe(DIGEST);
    await vi.waitFor(() => expect(net.hub.artifactSeeds.activeGrants).toBe(0));
    const types = net.sent.map(entry => `${entry.workerId}:${entry.type}`);
    expect(types).toEqual(expect.arrayContaining(["w-seed:artifact.seed.grant", "w-req:artifact.seed.grant",
      "w-seed:artifact.seed.bind", "w-seed:runtime.direct.offer", "w-req:runtime.direct.commit"]));
    // The seed learned the authenticated requester before the direct offer.
    expect(types.indexOf("w-seed:artifact.seed.bind")).toBeLessThan(types.indexOf("w-seed:runtime.direct.offer"));
    // No weight byte ever crossed the coordinator relay.
    expect(types.some(type => type.endsWith("runtime.stream.data") || type === "w-seed:runtime.stream.open")).toBe(false);
    expect(await net.requesterPeer.requestBlob(DIGEST, BLOB.byteLength)).toEqual({ ok: true, published: false });
  });

  it.each(["unreachable", "absent"] as const)(
    "refuses the relay when the direct channel is %s and leaves the requester on its origin",
    async (direct) => {
      const net = await network({ direct });
      const endpoint = await net.requesterPeer.requesterEndpoint();
      // Python's stage cache asks this endpoint first; anything but 200 means "use the origin".
      const response = await fetch(`${endpoint.url}/v1/artifact-seed/blobs/${DIGEST}?sizeBytes=${BLOB.byteLength}`,
        { method: "POST", headers: { [ARTIFACT_SEED_ENDPOINT_TOKEN_HEADER]: endpoint.token } });
      expect(response.status).toBe(404);
      expect(((await response.json()) as { ok: boolean }).ok).toBe(false);
      expect(existsSync(artifactSeedBlobPath(net.requesterCas, DIGEST))).toBe(false);
      await vi.waitFor(() => expect(net.hub.artifactSeeds.activeGrants).toBe(0));
      const types = net.sent.map(entry => `${entry.workerId}:${entry.type}`);
      expect(types).toContain("w-seed:artifact.seed.revoke");
      expect(types).toContain("w-req:artifact.seed.revoke");
      // The hub never opened a relay to the seed port and no data was relayed.
      expect(types).not.toContain("w-seed:runtime.stream.open");
      expect(types.some(type => type.endsWith("runtime.stream.data"))).toBe(false);
    },
  );

  it("never serves the seed port to a relay open, even if a coordinator forwarded one", async () => {
    const net = await network();
    const seedTunnel = net.tunnels.get("w-seed")!;
    const port = (net.workers[0]!.capabilities.artifactSeed as { servicePort: number }).servicePort;
    await seedTunnel.handle({ type: "runtime.stream.open", payload: { streamId: "forged", targetPort: port } });
    // The seed tunnel answers the relay open with an error and never connects.
    expect(net.sent).toContainEqual({ workerId: "w-seed", type: "runtime.stream.error" });
    expect(net.sent).not.toContainEqual({ workerId: "w-seed", type: "runtime.stream.opened" });
  });

  it("requester tunnel abandons a seed stream that a coordinator tries to open as relay", async () => {
    const opens: Array<{ streamId: string }> = [];
    const tunnel = new RuntimeStreamTunnel("requester-node", (type, payload) => {
      if (type === "runtime.stream.open") opens.push(payload as { streamId: string });
      return true;
    });
    cleanup.push(() => tunnel.close());
    const socket = await tunnel.openArtifactSeedStream("seed-node", 41_000);
    await vi.waitFor(() => expect(opens).toHaveLength(1));
    const closed = new Promise(resolve => socket.once("close", resolve));
    socket.resume();
    await tunnel.handle({ type: "runtime.stream.opened", payload: { streamId: opens[0]!.streamId } });
    await closed;
    expect(tunnel.transportSnapshot().some(item => item.state === "active")).toBe(false);
  });

  it("keeps the origin route without a fresh direct measurement", async () => {
    for (const links of [[], [{ ...directLink("seed-node", "requester-node"), transportMode: "relay" as const }],
      [directLink("seed-node", "requester-node", Date.now() - 200_000)]]) {
      const net = await network({ links });
      expect(await net.requesterPeer.requestBlob(DIGEST, BLOB.byteLength))
        .toEqual({ ok: false, code: "artifact_seed_no_measured_seed" });
    }
  });

  it("denies seed streams without a matching grant for the authenticated source", async () => {
    const net = await network();
    const seed = net.workers.find(entry => entry.id === "w-seed")!;
    const port = (seed.capabilities.artifactSeed as { servicePort: number }).servicePort;
    expect(net.hub.artifactSeeds.authorizeStream({ sourceWorkerId: "w-req", sourceNodeId: "requester-node", destination: seed,
      targetPort: port, streamId: "s-1" })).toBe("denied");
    expect(net.hub.artifactSeeds.authorizeStream({ sourceWorkerId: "w-req", sourceNodeId: "requester-node", destination: seed,
      targetPort: port + 1, streamId: "s-2" })).toBe("not-seed");
  });
});

describe("artifact seed broker grants and revocation", () => {
  function brokerFixture(overrides: { downlinkMbps?: number } = {}) {
    const sent: Array<{ workerId: string; type: string; payload: Record<string, unknown> }> = [];
    const observation = (servicePort: number) => ({
      schema: "mycellios-artifact-seed-observation/1", ready: true,
      inventoryRevision: createHash("sha256").update(DIGEST).digest("hex"), verifiedBlobSha256s: [DIGEST],
      freeTransferSlots: 1, quotaBytes: 10_000_000, heldBytes: BLOB.byteLength, servicePort, observedAt: Date.now() / 1_000,
    });
    const requester = worker("w-req", "requester-node", undefined);
    requester.capabilities.network.downlinkMbps = overrides.downlinkMbps ?? 10;
    const workers = [worker("w-seed", "seed-node", observation(41_000)), requester];
    const broker = new ArtifactSeedBroker({
      listWorkers: async () => workers,
      connectedWorkerIds: () => new Set(["w-seed", "w-req"]),
      linkObservations: () => [directLink("seed-node", "requester-node")],
      send: (workerId, type, payload) => { sent.push({ workerId, type, payload: payload as Record<string, unknown> }); return true; },
      randomToken: () => "k".repeat(43),
    });
    cleanup.push(() => broker.close());
    return { broker, sent, workers };
  }
  const demand = { demandId: "d-1", blobSha256: DIGEST, sizeBytes: BLOB.byteLength };

  it("delivers one single-use grant to the seed first, then to the requester", async () => {
    const { broker, sent } = brokerFixture();
    await broker.handle("w-req", "artifact.seed.demand", demand);
    expect(sent.map(entry => [entry.workerId, entry.type])).toEqual([
      ["w-seed", "artifact.seed.grant"], ["w-req", "artifact.seed.grant"]]);
    const [source, requester] = sent;
    expect(source!.payload).toMatchObject({ role: "source", grant: { sourceNodeId: "seed-node", requesterNodeId: "requester-node",
      blobSha256: DIGEST, sizeBytes: BLOB.byteLength } });
    expect(requester!.payload).toMatchObject({ role: "requester", demandId: "d-1", seedTargetPort: 41_000 });
    expect((requester!.payload.grant as { token: string }).token).toBe((source!.payload.grant as { token: string }).token);
    await broker.handle("w-req", "artifact.seed.demand", { ...demand, demandId: "d-2" });
    expect(sent.at(-1)).toMatchObject({ workerId: "w-req", type: "artifact.seed.unavailable",
      payload: { demandId: "d-2", code: "artifact_seed_not_planned" } });
  });

  it("abandons a bound stream that would fall back to the relay, also after the grant ended", async () => {
    const { broker, sent, workers } = brokerFixture();
    await broker.handle("w-req", "artifact.seed.demand", demand);
    expect(broker.authorizeStream({ sourceWorkerId: "w-req", sourceNodeId: "requester-node", destination: workers[0]!,
      targetPort: 41_000, streamId: "seed-stream" })).toBe("authorized");
    expect(broker.abandonRelay("seed-stream")).toBe(true);
    expect(broker.activeGrants).toBe(0);
    expect(sent.filter(entry => entry.type === "artifact.seed.revoke").map(entry => entry.workerId).sort())
      .toEqual(["w-req", "w-seed"]);
    expect(broker.abandonRelay("seed-stream")).toBe(true);
    expect(broker.abandonRelay("ordinary-runtime-stream")).toBe(false);
  });

  it("revokes on pause, disconnect and expiry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (const end of ["pause", "disconnect", "expiry"] as const) {
      const { broker, sent, workers } = brokerFixture();
      await broker.handle("w-req", "artifact.seed.demand", demand);
      expect(broker.activeGrants).toBe(1);
      if (end === "pause") broker.observeHeartbeat("w-seed", "s", workers[0]!.capabilities, "draining");
      else if (end === "disconnect") broker.revokeWorker("w-req");
      else vi.advanceTimersByTime(121_000);
      expect(broker.activeGrants).toBe(0);
      expect(sent.filter(entry => entry.type === "artifact.seed.revoke").map(entry => entry.workerId).sort())
        .toEqual(["w-req", "w-seed"]);
    }
  });

  it("keeps the origin when the requester's downlink is unmeasured", async () => {
    const { broker, sent } = brokerFixture({ downlinkMbps: 0 });
    await broker.handle("w-req", "artifact.seed.demand", demand);
    expect(sent).toEqual([{ workerId: "w-req", type: "artifact.seed.unavailable",
      payload: { demandId: "d-1", code: "artifact_seed_origin_unmeasured" } }]);
  });
});
