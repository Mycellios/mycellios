import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { safeVramBudget } from "../core/tiers.js";
import type { MeshStore, StoredWorker } from "../storage/store.js";
import { DeploymentControlPlane, type RouteReservation } from "./deployment-control-plane.js";

/**
 * Demand-driven placement of native GPU replicas (Kokoro, Whisper, embeddings)
 * that share one physical GPU. The coordinator owns their reservations: it
 * keeps a replica's committed reservation alive while it is wanted, and
 * releases the least recently used idle replica when another model with demand
 * does not fit. Each replica's runner already exits when its reservation
 * disappears and restarts when one is committed again, so granting and
 * releasing a reservation is what loads and unloads the model.
 *
 * Specification: specs/on-demand-replica-placement/spec.md
 */

const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);

export const nativeReplicaPlacementConfigSchema = z.object({
  schema: z.literal("mycellios-native-replica-placement/1"),
  idleMs: z.number().int().min(60_000).max(86_400_000).default(600_000),
  minResidencyMs: z.number().int().min(30_000).max(3_600_000).default(180_000),
  releaseGapMs: z.number().int().min(5_000).max(300_000).default(30_000),
  reservationTtlMs: z.number().int().min(60_000).max(180_000).default(180_000),
  tickMs: z.number().int().min(5_000).max(60_000).default(15_000),
  replicas: z.array(z.object({
    consumerId: z.string().min(1).max(200),
    /** Requested-model id that owns the reservation (timeline id). */
    modelId: z.string().min(1).max(200),
    /** Public model ids whose requests count as demand for this replica. */
    requestModels: z.array(z.string().min(1).max(200)).min(1).max(16),
    source: z.string().min(1),
    revision: z.string().min(1),
    nodeId: z.string().min(1),
    deviceName: z.string().min(1),
    gpuFingerprint: z.string().min(1),
    memoryMiB: z.number().int().min(512),
    artifactBytes: z.number().int().nonnegative().default(0),
    layerEnd: z.number().int().positive().default(1),
    /** Lower numbers are loaded first when idle capacity is filled. */
    priority: z.number().int().min(0).max(100).default(50),
    /** Never released for another replica (still released if its node leaves). */
    pinned: z.boolean().default(false),
    canaryReceiptPath: z.string().min(1),
    canaryReceiptSha256: sha256Hex,
    operationMetadata: z.record(z.string(), z.unknown()).default({}),
    canary: z.record(z.string(), z.unknown()),
  }).strict()).min(1).max(32),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  const models = new Set<string>();
  for (const replica of config.replicas) {
    if (ids.has(replica.consumerId)) context.addIssue({ code: "custom", message: `duplicate consumer ${replica.consumerId}` });
    if (models.has(replica.modelId)) context.addIssue({ code: "custom", message: `duplicate model ${replica.modelId}` });
    ids.add(replica.consumerId);
    models.add(replica.modelId);
    if (replica.canary.consumerId !== replica.consumerId || replica.canary.nodeId !== replica.nodeId) {
      context.addIssue({ code: "custom", message: `canary of ${replica.consumerId} is bound to another consumer or node` });
    }
  }
});

export type NativeReplicaPlacementConfig = z.infer<typeof nativeReplicaPlacementConfigSchema>;
export type NativeReplicaConfig = NativeReplicaPlacementConfig["replicas"][number];

export interface ReplicaDemand {
  lastRequestAt: number;
  /** First unserved request since the replica was last available. */
  unservedSince: number | null;
}

/** Bounded in-memory record of recent requests per public model id. */
export class ReplicaDemandLedger {
  private readonly entries = new Map<string, ReplicaDemand>();

  constructor(private readonly tracked: ReadonlySet<string>) {}

  record(model: string, served: boolean, now = Date.now()): void {
    if (!this.tracked.has(model)) return;
    const current = this.entries.get(model);
    this.entries.set(model, {
      lastRequestAt: Math.max(current?.lastRequestAt ?? 0, now),
      unservedSince: served ? null : current?.unservedSince ?? now,
    });
  }

  forReplica(replica: Pick<NativeReplicaConfig, "requestModels">): ReplicaDemand {
    let lastRequestAt = 0;
    let unservedSince: number | null = null;
    for (const model of replica.requestModels) {
      const entry = this.entries.get(model);
      if (!entry) continue;
      lastRequestAt = Math.max(lastRequestAt, entry.lastRequestAt);
      if (entry.unservedSince !== null) {
        unservedSince = unservedSince === null ? entry.unservedSince : Math.min(unservedSince, entry.unservedSince);
      }
    }
    return { lastRequestAt, unservedSince };
  }
}

export interface PlacementReplica {
  consumerId: string;
  nodeId: string;
  memoryMiB: number;
  priority: number;
  pinned: boolean;
  demand: ReplicaDemand;
  /** Currently holds a live committed reservation, and since when. */
  heldSince: number | null;
  /** A request is running on this replica right now. */
  busy: boolean;
}

export interface PlacementInput {
  now: number;
  idleMs: number;
  minResidencyMs: number;
  /** Safe GPU budget per eligible node; a missing node is not eligible. */
  capacityByNode: ReadonlyMap<string, number>;
  /** Memory still occupied by recently released replicas, per node. */
  drainingByNode: ReadonlyMap<string, number>;
  replicas: readonly PlacementReplica[];
}

export interface PlacementDecision {
  keep: string[];
  grant: string[];
  release: string[];
  waiting: string[];
}

function idleFor(replica: PlacementReplica, now: number): number {
  return now - replica.demand.lastRequestAt;
}

function evictable(replica: PlacementReplica, input: PlacementInput): boolean {
  return replica.heldSince !== null
    && !replica.pinned
    && !replica.busy
    && idleFor(replica, input.now) >= input.idleMs
    && input.now - replica.heldSince >= input.minResidencyMs;
}

/**
 * Pure placement step. Replicas with unserved demand are placed first (oldest
 * unserved request first); if they do not fit, the least recently used idle
 * replicas on the same node are released. Remaining free capacity is filled
 * with the most recently demanded (then highest priority) replicas so warm
 * models stay ready. A replica is never released while busy, pinned, recently
 * loaded or recently used.
 */
export function planReplicaPlacement(input: PlacementInput): PlacementDecision {
  const keep = new Set<string>();
  const grant = new Set<string>();
  const release = new Set<string>();
  const used = new Map<string, number>();
  const add = (nodeId: string, memoryMiB: number) => used.set(nodeId, (used.get(nodeId) ?? 0) + memoryMiB);
  const free = (nodeId: string) => (input.capacityByNode.get(nodeId) ?? 0)
    - (used.get(nodeId) ?? 0) - (input.drainingByNode.get(nodeId) ?? 0);

  for (const replica of input.replicas) {
    if (replica.heldSince === null) continue;
    if (!input.capacityByNode.has(replica.nodeId)) {
      release.add(replica.consumerId);
      continue;
    }
    keep.add(replica.consumerId);
    add(replica.nodeId, replica.memoryMiB);
  }

  const wanted = input.replicas
    .filter(replica => replica.heldSince === null && replica.demand.unservedSince !== null
      && input.capacityByNode.has(replica.nodeId))
    .sort((left, right) => left.demand.unservedSince! - right.demand.unservedSince!
      || left.priority - right.priority || left.consumerId.localeCompare(right.consumerId));
  const waiting: string[] = [];
  for (const replica of wanted) {
    if (replica.memoryMiB > (input.capacityByNode.get(replica.nodeId) ?? 0)) {
      waiting.push(replica.consumerId);
      continue;
    }
    if (free(replica.nodeId) < replica.memoryMiB) {
      const candidates = input.replicas
        .filter(other => other.nodeId === replica.nodeId && keep.has(other.consumerId) && evictable(other, input))
        .sort((left, right) => left.demand.lastRequestAt - right.demand.lastRequestAt
          || right.priority - left.priority || left.consumerId.localeCompare(right.consumerId));
      let reclaimable = free(replica.nodeId);
      const chosen: PlacementReplica[] = [];
      for (const candidate of candidates) {
        if (reclaimable >= replica.memoryMiB) break;
        chosen.push(candidate);
        reclaimable += candidate.memoryMiB;
      }
      if (reclaimable < replica.memoryMiB) {
        waiting.push(replica.consumerId);
        continue;
      }
      for (const victim of chosen) {
        keep.delete(victim.consumerId);
        release.add(victim.consumerId);
        add(victim.nodeId, -victim.memoryMiB);
      }
      // Released memory is only reusable after the old process exits.
      waiting.push(replica.consumerId);
      continue;
    }
    grant.add(replica.consumerId);
    add(replica.nodeId, replica.memoryMiB);
  }

  const releasingNodes = new Set(input.replicas.filter(replica => release.has(replica.consumerId)).map(replica => replica.nodeId));
  const warm = input.replicas
    .filter(replica => replica.heldSince === null && !grant.has(replica.consumerId)
      && !waiting.includes(replica.consumerId) && input.capacityByNode.has(replica.nodeId)
      && !releasingNodes.has(replica.nodeId))
    .sort((left, right) => right.demand.lastRequestAt - left.demand.lastRequestAt
      || left.priority - right.priority || left.consumerId.localeCompare(right.consumerId));
  for (const replica of warm) {
    if (free(replica.nodeId) < replica.memoryMiB) continue;
    grant.add(replica.consumerId);
    add(replica.nodeId, replica.memoryMiB);
  }

  return { keep: [...keep].sort(), grant: [...grant].sort(), release: [...release].sort(), waiting: waiting.sort() };
}

export interface ReplicaPlacementLogger {
  info(message: string): void;
  warn(message: string): void;
}

/** Coordinator-owned broker that applies {@link planReplicaPlacement}. */
export class NativeReplicaPlacementBroker {
  readonly demand: ReplicaDemandLedger;
  private readonly heldSince = new Map<string, number>();
  private readonly draining = new Map<string, { nodeId: string; memoryMiB: number; until: number }>();
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly store: MeshStore,
    private readonly config: NativeReplicaPlacementConfig,
    private readonly logger: ReplicaPlacementLogger,
    private readonly connectedWorkerIds: () => ReadonlySet<string> | readonly string[] = () => [],
  ) {
    this.demand = new ReplicaDemandLedger(new Set(config.replicas.flatMap(replica => replica.requestModels)));
  }

  start(): void {
    if (this.timer) return;
    const run = () => {
      if (this.running) return;
      this.running = this.tick().then(() => undefined, (error: unknown) => {
        this.logger.warn(`native_replica_placement_tick_failed:${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => { this.running = null; });
    };
    this.timer = setInterval(run, this.config.tickMs);
    this.timer.unref?.();
    run();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  async tick(now = Date.now()): Promise<PlacementDecision> {
    for (const [consumerId, entry] of this.draining) if (entry.until <= now) this.draining.delete(consumerId);
    const workers = await this.store.listWorkers();
    const capacityByNode = gpuCapacityByNode(this.config.replicas, workers, now);
    const held = new Map<string, RouteReservation>();
    for (const replica of this.config.replicas) {
      const own = await ownedReservations(this.store, replica, now);
      if (own.length > 1) throw new Error(`duplicate_owned_gpu_reservation:${replica.consumerId}`);
      if (own[0]) held.set(replica.consumerId, own[0]);
      else this.heldSince.delete(replica.consumerId);
      if (own[0] && !this.heldSince.has(replica.consumerId)) this.heldSince.set(replica.consumerId, own[0].committedAt ?? now);
    }
    const busy = busyModels(workers, this.connectedWorkerIds());
    const drainingByNode = new Map<string, number>();
    for (const entry of this.draining.values()) {
      drainingByNode.set(entry.nodeId, (drainingByNode.get(entry.nodeId) ?? 0) + entry.memoryMiB);
    }
    const decision = planReplicaPlacement({
      now,
      idleMs: this.config.idleMs,
      minResidencyMs: this.config.minResidencyMs,
      capacityByNode,
      drainingByNode,
      replicas: this.config.replicas.map(replica => ({
        consumerId: replica.consumerId,
        nodeId: replica.nodeId,
        memoryMiB: replica.memoryMiB,
        priority: replica.priority,
        pinned: replica.pinned,
        demand: this.demand.forReplica(replica),
        heldSince: held.has(replica.consumerId) ? this.heldSince.get(replica.consumerId)! : null,
        busy: replica.requestModels.some(model => busy.has(model)),
      })),
    });
    const byId = new Map(this.config.replicas.map(replica => [replica.consumerId, replica]));
    for (const consumerId of decision.release) {
      const replica = byId.get(consumerId)!;
      await new DeploymentControlPlane(this.store, replica.consumerId).releaseRoutesForModel(replica.modelId, now);
      this.heldSince.delete(consumerId);
      this.draining.set(consumerId, { nodeId: replica.nodeId, memoryMiB: replica.memoryMiB, until: now + this.config.releaseGapMs });
      this.logger.info(`native_replica_released:${consumerId}`);
    }
    for (const consumerId of decision.keep) {
      const replica = byId.get(consumerId)!;
      const reservation = held.get(consumerId)!;
      const control = new DeploymentControlPlane(this.store, replica.consumerId);
      if (!(await control.renewRoute(reservation.id, this.config.reservationTtlMs, now))) {
        this.heldSince.delete(consumerId);
        this.logger.warn(`native_replica_renewal_failed:${consumerId}`);
      }
    }
    for (const consumerId of decision.grant) {
      const replica = byId.get(consumerId)!;
      try {
        await commitReplicaReservation(this.store, replica, capacityByNode.get(replica.nodeId)!, this.config.reservationTtlMs, now);
        this.heldSince.set(consumerId, now);
        this.logger.info(`native_replica_granted:${consumerId}`);
      } catch (error) {
        this.logger.warn(`native_replica_grant_failed:${consumerId}:${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return decision;
  }
}

export async function loadNativeReplicaPlacementConfig(path: string): Promise<NativeReplicaPlacementConfig> {
  const config = nativeReplicaPlacementConfigSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
  for (const replica of config.replicas) {
    const digest = createHash("sha256").update(await readFile(replica.canaryReceiptPath)).digest("hex");
    if (digest !== replica.canaryReceiptSha256) throw new Error(`native_canary_receipt_changed:${replica.consumerId}`);
  }
  return config;
}

/** Safe GPU budget of each configured node whose physical GPU is fresh and verified. */
export function gpuCapacityByNode(
  replicas: readonly Pick<NativeReplicaConfig, "nodeId" | "deviceName" | "gpuFingerprint">[],
  workers: readonly StoredWorker[],
  now: number,
): Map<string, number> {
  const capacity = new Map<string, number>();
  for (const replica of replicas) {
    if (capacity.has(replica.nodeId)) continue;
    const executors = workers.filter(worker => worker.status === "online" && now - worker.lastSeenAt < 15_000
      && worker.capabilities.distributedExecutor?.nodeId === replica.nodeId);
    if (executors.length !== 1) continue;
    const worker = executors[0]!;
    const executor = worker.capabilities.distributedExecutor!;
    if (executor.acceleration?.state !== "gpu-ready" || executor.acceleration?.backend !== "cuda"
      || !executor.physicalIdentity?.gpuFingerprintsSha256.includes(replica.gpuFingerprint)) continue;
    const gpus = worker.capabilities.gpus.filter(gpu => gpu.vendor === "nvidia" && gpu.model === replica.deviceName);
    if (gpus.length !== 1) continue;
    capacity.set(replica.nodeId, safeVramBudget(Math.min(gpus[0]!.physicalVramMb, gpus[0]!.offeredVramMb)));
  }
  return capacity;
}

function busyModels(workers: readonly StoredWorker[], connected: ReadonlySet<string> | readonly string[]): Set<string> {
  const online = new Set(connected);
  const busy = new Set<string>();
  for (const worker of workers) {
    if (worker.status !== "online" || (online.size > 0 && !online.has(worker.id))) continue;
    for (const deployment of worker.capabilities.deployments) {
      if (deployment.freeSlots < deployment.maxConcurrency) busy.add(deployment.model);
    }
  }
  return busy;
}

async function ownedReservations(store: MeshStore, replica: NativeReplicaConfig, now: number): Promise<RouteReservation[]> {
  const control = new DeploymentControlPlane(store, replica.consumerId);
  return (await control.listReservations(replica.modelId)).filter(reservation => reservation.status === "committed"
    && reservation.expiresAt > now && reservation.canary?.consumerId === replica.consumerId
    && reservation.stages.length === 1 && reservation.stages[0]!.nodeId === replica.nodeId
    && reservation.stages[0]!.memoryMiB === replica.memoryMiB);
}

/** Prepares and commits one replica reservation, as the former keeper did. */
export async function commitReplicaReservation(
  store: MeshStore,
  replica: NativeReplicaConfig,
  capacityMiB: number,
  ttlMs: number,
  now: number,
): Promise<RouteReservation> {
  if (replica.memoryMiB > capacityMiB) throw new Error("invalid_replica_memory_budget");
  const control = new DeploymentControlPlane(store, replica.consumerId);
  return store.database.transaction(async () => {
    const existing = await store.getRequestedModel(replica.modelId);
    if (existing && (existing.source !== replica.source || existing.revision !== replica.revision)) {
      throw new Error("existing_model_identity_conflict");
    }
    if (!existing) {
      await store.upsertRequestedModel({
        id: replica.modelId, source: replica.source, revision: replica.revision,
        contextTokens: 512, minimumNodes: 1, autoActivate: false,
      });
    }
    const state = await control.getState(replica.modelId);
    if (state && state.activeOperationId === null) {
      await control.rearmAfterRuntimeChange(replica.modelId, "Native replica GPU placement requires a new lease", now);
    }
    const operation = await control.claimOperation(replica.modelId, "activate", {
      now, leaseMs: 120_000,
      metadata: { ...replica.operationMetadata, consumerId: replica.consumerId, kind: "native-gpu-replica" },
    });
    if (!operation) throw new Error("model_operation_owned_by_other_controller");
    const prepared = await control.prepareRoute(operation.id, [{
      nodeId: replica.nodeId, stageIndex: 0, layerStart: 0, layerEnd: replica.layerEnd,
      memoryMiB: replica.memoryMiB, capacityMiB, artifactBytes: replica.artifactBytes,
    }], ttlMs, now);
    return control.commitRoute(prepared.id, { ...replica.canary, consumerId: replica.consumerId, nodeId: replica.nodeId }, now);
  });
}
