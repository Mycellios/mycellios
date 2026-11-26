import { randomUUID } from "node:crypto";
import {
  artifactSeedCompletePayloadSchema,
  artifactSeedDemandPayloadSchema,
  artifactSeedObservationSchema,
  type ArtifactSeedGrant,
} from "../contracts/artifact-seed.js";
import {
  selectPreferredRuntimeLinkObservation,
  type RuntimeLinkObservation,
} from "../contracts/runtime-link-observations.js";
import { issueArtifactSeedGrants } from "../distribution/artifact-seed-grants.js";
import { planFleetResourceRoles, type FleetResourceEvidence } from "../distribution/fleet-resource-roles.js";
import type { StoredWorker } from "../storage/store.js";
import { collectFleetResourceEvidence } from "./fleet-resource-evidence.js";

const MAX_ACTIVE_GRANTS = 256;
const MAX_ACTIVE_PER_REQUESTER = 4;
const LINK_FRESH_MS = 120_000;
/** Longer than any direct negotiation, so a late relay fallback is still refused. */
const SEED_STREAM_MEMORY_MS = 10 * 60_000;
const MAX_SEED_STREAMS = 1_024;

export interface ArtifactSeedBrokerDependencies {
  listWorkers(): Promise<StoredWorker[]>;
  connectedWorkerIds(): ReadonlySet<string>;
  linkObservations(now: number): RuntimeLinkObservation[];
  send(workerId: string, type: string, payload: unknown): boolean;
  now?: () => number;
  randomToken?: () => string;
  /** Content-free counters only (codes, never digests or tokens). */
  onEvent?: (code: string) => void;
}

interface ActiveGrant {
  grant: ArtifactSeedGrant;
  seedWorkerId: string;
  requesterWorkerId: string;
  seedTargetPort: number;
  streamId: string | null;
  timer: NodeJS.Timeout;
}

/**
 * Coordinator side of artifact seeding (specs/artifact-seed-nodes): turns one
 * requester demand into a measured plan, delivers single-use grants to both
 * authenticated sessions, binds runtime streams and revokes on any change.
 */
export class ArtifactSeedBroker {
  private readonly active = new Map<string, ActiveGrant>();
  private readonly readySessions = new Map<string, string>();
  private readonly seedStreams = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: ArtifactSeedBrokerDependencies) {
    this.now = deps.now ?? Date.now;
  }

  get activeGrants(): number {
    return this.active.size;
  }

  /**
   * Heartbeat hook: announce the protocol once per session to workers that
   * advertise it, and revoke grants as soon as a node stops contributing.
   */
  observeHeartbeat(workerId: string, sessionId: string, capabilities: StoredWorker["capabilities"], status: StoredWorker["status"]): void {
    if (capabilities.artifactSeed !== undefined && this.readySessions.get(workerId) !== sessionId) {
      if (this.deps.send(workerId, "artifact.seed.ready", {})) this.readySessions.set(workerId, sessionId);
    }
    const seed = capabilities.artifactSeed;
    if (status !== "online" || (seed !== undefined && !seed.ready && this.isSeed(workerId))) this.revokeWorker(workerId);
  }

  /** Disconnect, pause or removal: end every grant involving this worker. */
  revokeWorker(workerId: string): void {
    this.readySessions.delete(workerId);
    for (const entry of [...this.active.values()]) {
      if (entry.seedWorkerId === workerId || entry.requesterWorkerId === workerId) this.end(entry, "artifact_seed_revoked");
    }
  }

  async handle(workerId: string, type: string, payload: unknown): Promise<void> {
    if (type === "artifact.seed.demand") await this.demand(workerId, payload);
    else if (type === "artifact.seed.complete") this.complete(workerId, payload);
  }

  /**
   * Classify a runtime stream open. A stream to a seed's advertised service
   * port is admitted only for an active grant whose requester is the
   * authenticated source node; the seed is told that identity first.
   */
  authorizeStream(input: {
    sourceWorkerId: string;
    sourceNodeId: string | null | undefined;
    destination: StoredWorker;
    targetPort: number;
    streamId: string;
  }): "not-seed" | "authorized" | "denied" {
    const observation = artifactSeedObservationSchema.safeParse(input.destination.capabilities.artifactSeed);
    if (!observation.success || observation.data.servicePort !== input.targetPort) return "not-seed";
    const destinationNodeId = input.destination.capabilities.distributedExecutor?.nodeId;
    const now = this.now();
    const entry = [...this.active.values()].find(value => value.streamId === null
      && value.requesterWorkerId === input.sourceWorkerId
      && value.grant.requesterNodeId === input.sourceNodeId
      && value.grant.sourceNodeId === destinationNodeId
      && value.seedWorkerId === input.destination.id
      && value.seedTargetPort === input.targetPort
      && value.grant.expiresAtMs > now);
    if (!entry) {
      this.deps.onEvent?.("artifact_seed_stream_denied");
      return "denied";
    }
    entry.streamId = input.streamId;
    this.rememberSeedStream(input.streamId);
    if (!this.deps.send(entry.seedWorkerId, "artifact.seed.bind", {
      streamId: input.streamId, requesterNodeId: entry.grant.requesterNodeId, expiresAtMs: entry.grant.expiresAtMs,
    })) {
      this.end(entry, "artifact_seed_source_unreachable");
      return "denied";
    }
    return "authorized";
  }

  /**
   * Seed streams are direct-only. When the hub would route one through the
   * coordinator relay (no direct support or failed negotiation), the grant
   * ends on both sides and the requester falls back to its origin.
   */
  abandonRelay(streamId: string): boolean {
    const entry = [...this.active.values()].find(value => value.streamId === streamId);
    if (entry) this.end(entry, "artifact_seed_direct_required");
    // Also after the grant ended: an admitted seed stream never becomes relay.
    return entry !== undefined || this.seedStreams.has(streamId);
  }

  private rememberSeedStream(streamId: string): void {
    const now = this.now();
    for (const [id, at] of this.seedStreams) if (now - at > SEED_STREAM_MEMORY_MS) this.seedStreams.delete(id);
    if (this.seedStreams.size >= MAX_SEED_STREAMS) this.seedStreams.delete(this.seedStreams.keys().next().value!);
    this.seedStreams.set(streamId, now);
  }

  close(): void {
    for (const entry of [...this.active.values()]) this.end(entry, "artifact_seed_revoked", false);
  }

  private async demand(requesterWorkerId: string, value: unknown): Promise<void> {
    const parsed = artifactSeedDemandPayloadSchema.safeParse(value);
    if (!parsed.success) return;
    const demand = parsed.data;
    const unavailable = (code: string) => {
      this.deps.onEvent?.(code);
      this.deps.send(requesterWorkerId, "artifact.seed.unavailable", { demandId: demand.demandId, code });
    };
    const now = this.now();
    const workers = await this.deps.listWorkers();
    const connected = this.deps.connectedWorkerIds();
    const requester = workers.find(worker => worker.id === requesterWorkerId);
    const requesterNodeId = requester?.capabilities.distributedExecutor?.nodeId;
    if (!requester || !requesterNodeId || requester.status !== "online" || !connected.has(requester.id)) {
      unavailable("artifact_seed_requester_unavailable");
      return;
    }
    if (this.active.size >= MAX_ACTIVE_GRANTS
        || [...this.active.values()].filter(entry => entry.requesterWorkerId === requesterWorkerId).length >= MAX_ACTIVE_PER_REQUESTER) {
      unavailable("artifact_seed_busy");
      return;
    }
    // Origin estimate: the requester's own measured downlink. Without it no
    // seed can be shown faster, so the requester keeps its origin route.
    const downlinkMbps = requester.capabilities.network.downlinkMbps;
    if (!(downlinkMbps > 0)) {
      unavailable("artifact_seed_origin_unmeasured");
      return;
    }
    const base = collectFleetResourceEvidence({ workers, connectedWorkerIds: connected, nowMs: now });
    const links = this.deps.linkObservations(now);
    const peers: FleetResourceEvidence["demands"][number]["peers"] = [];
    const nodes = base.nodes.map(node => {
      if (!node.seed) return node;
      // Grants already handed out consume the seed's reported slots.
      const busy = [...this.active.values()].filter(entry => entry.grant.sourceNodeId === node.nodeId).length;
      const seed = { ...node.seed, freeTransferSlots: Math.max(0, node.seed.freeTransferSlots - busy) };
      if (node.nodeId !== requesterNodeId && seed.ready && seed.verifiedBlobSha256s.includes(demand.blobSha256)) {
        // Seeding is planned only on measured direct links: weights never
        // traverse the coordinator relay by design.
        const link = selectPreferredRuntimeLinkObservation(links.filter(observation =>
          observation.fromNodeId === node.nodeId && observation.toNodeId === requesterNodeId
          && observation.transportMode === "direct"));
        if (link && link.goodputMbpsP50 > 0 && now - link.measuredAt <= LINK_FRESH_MS && link.measuredAt <= now) {
          peers.push({ nodeId: node.nodeId, measuredAtMs: link.measuredAt, rttMs: link.rttP50Ms,
            goodputMbps: link.goodputMbpsP50,
            uncertaintyMs: Math.max(0, link.rttP95Ms - link.rttP50Ms) + link.jitterP95Ms });
        }
      }
      return { ...node, seed };
    });
    if (peers.length === 0) {
      unavailable("artifact_seed_no_measured_seed");
      return;
    }
    const transferId = randomUUID();
    const plan = planFleetResourceRoles([], { nodes, demands: [{
      requestId: transferId, requesterNodeId, blobSha256: demand.blobSha256, sizeBytes: demand.sizeBytes,
      originExpectedMs: demand.sizeBytes * 8 / (downlinkMbps * 1_000), peers,
    }] }, now);
    const grant = issueArtifactSeedGrants(plan, { now, ...(this.deps.randomToken ? { randomToken: this.deps.randomToken } : {}) })[0];
    const seedWorker = grant && workers.find(worker => worker.capabilities.distributedExecutor?.nodeId === grant.sourceNodeId
      && connected.has(worker.id) && worker.status === "online");
    const seedTargetPort = seedWorker
      ? artifactSeedObservationSchema.safeParse(seedWorker.capabilities.artifactSeed).data?.servicePort : undefined;
    if (!grant || !seedWorker || seedTargetPort === undefined) {
      unavailable("artifact_seed_not_planned");
      return;
    }
    const timer = setTimeout(() => {
      const entry = this.active.get(grant.transferId);
      if (entry) this.end(entry, "artifact_seed_grant_expired");
    }, Math.max(1, grant.expiresAtMs - now));
    timer.unref?.();
    const entry: ActiveGrant = { grant, seedWorkerId: seedWorker.id, requesterWorkerId, seedTargetPort, streamId: null, timer };
    this.active.set(grant.transferId, entry);
    // The source must hold the grant before the requester can open its stream.
    if (!this.deps.send(seedWorker.id, "artifact.seed.grant", { role: "source", grant })
        || !this.deps.send(requesterWorkerId, "artifact.seed.grant", { role: "requester", demandId: demand.demandId, grant, seedTargetPort })) {
      this.end(entry, "artifact_seed_source_unreachable");
      unavailable("artifact_seed_source_unreachable");
      return;
    }
    this.deps.onEvent?.("artifact_seed_granted");
  }

  private complete(workerId: string, value: unknown): void {
    const parsed = artifactSeedCompletePayloadSchema.safeParse(value);
    if (!parsed.success) return;
    const entry = this.active.get(parsed.data.transferId);
    if (!entry || (entry.seedWorkerId !== workerId && entry.requesterWorkerId !== workerId)) return;
    this.deps.onEvent?.(parsed.data.ok ? "artifact_seed_completed" : parsed.data.code ?? "artifact_seed_failed");
    this.end(entry, null);
  }

  private isSeed(workerId: string): boolean {
    return [...this.active.values()].some(entry => entry.seedWorkerId === workerId);
  }

  /** Remove a grant and tell both sides; the token is never usable again. */
  private end(entry: ActiveGrant, code: string | null, notify = true): void {
    if (!this.active.delete(entry.grant.transferId)) return;
    clearTimeout(entry.timer);
    if (code) this.deps.onEvent?.(code);
    if (!notify) return;
    const revoke = { transferIds: [entry.grant.transferId] };
    this.deps.send(entry.seedWorkerId, "artifact.seed.revoke", revoke);
    this.deps.send(entry.requesterWorkerId, "artifact.seed.revoke", revoke);
  }
}
