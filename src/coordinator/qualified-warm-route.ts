import { nativeBuildIdentitySchema } from "../contracts/build-identity.js";
import type { RuntimeTransportSnapshot } from "../contracts/runtime-transport.js";
import type { StoredWorker } from "../storage/store.js";
import type { AuthorizedWorkerSession } from "./worker-hub.js";
import type { DynamicActivationRecoveryContext, DynamicActivationRouteStage } from "./model-activation-manager.js";
import type { WarmRouteRecoveryLease } from "./warm-route-recovery.js";

interface Owner {
  nodeId: string;
  workerId: string;
  authority: string;
  source: string;
  identityId: string;
}
interface FleetView {
  listWorkers(): StoredWorker[] | Promise<StoredWorker[]>;
}
interface RecoveryHub {
  isConnected(workerId: string): boolean;
  authenticatedWorkerAuthority(workerId: string): AuthorizedWorkerSession | null | Promise<AuthorizedWorkerSession | null>;
  recoverablePeerTransports(): RuntimeTransportSnapshot[];
}
interface Baseline { owners: Owner[]; stages: DynamicActivationRouteStage[]; }

/** No job admission. A live managed launch may retain only its original owners,
 * native build, authenticated sessions, streams and native health snapshot. */
export class QualifiedWarmRouteAuthority {
  private readonly prepared = new Map<string, Baseline>();
  constructor(private readonly store: FleetView, private readonly hub: RecoveryHub) {}

  async prepare(modelId: string, stages: readonly DynamicActivationRouteStage[]): Promise<void> {
    this.forget(modelId);
    const nodes = stages.map(stage => stage.nodeId);
    if (nodes.length < 2 || new Set(nodes).size !== nodes.length) return;
    const owners = []; for (const node of nodes) owners.push(await this.owner(node));
    if (owners.some(owner => owner === null)) return;
    this.prepared.set(modelId, { owners: owners as Owner[], stages: stages.map(stage => ({ ...stage })) });
  }

  forget(modelId: string): void { this.prepared.delete(modelId); }

  async capture(modelId: string, context: DynamicActivationRecoveryContext): Promise<WarmRouteRecoveryLease | null> {
    const baseline = this.prepared.get(modelId);
    if (!baseline || !context.isCurrent() || (await this.ownerState(baseline)) !== "ready") return null;
    const launch = context.result.launch;
    const stages = [...launch.launchOrder].sort((a, b) => a.stageIndex - b.stageIndex);
    if (stages.length !== baseline.owners.length || stages[0]?.kind !== "root-engine"
      || stages.some((stage, index) => stage.stageIndex !== index || !stage.dense
        || stage.members.length !== 1 || stage.members[0]!.nodeId !== stage.anchor.memberId || stage.macroWave !== null
        || stage.anchor.memberId !== baseline.owners[index]!.nodeId
        || stage.stageIndex !== baseline.stages[index]!.stageIndex
        || stage.layerStart !== baseline.stages[index]!.layerStart || stage.layerEnd !== baseline.stages[index]!.layerEnd
        || stage.layerStart !== (index === 0 ? 0 : stages[index - 1]!.layerEnd)
        || stage.layerEnd <= stage.layerStart || stage.totalLayers !== launch.totalLayers
        || (stage.kind !== "root-engine" && stage.kind !== "remote-stage")
        || (stage.kind === "remote-stage" && stage.cell !== null)
        || stage.nativeGguf !== null)
      || stages.at(-1)!.layerEnd !== launch.totalLayers) return null;
    const root = stages[0];
    if (root.kind !== "root-engine" || !launch.launchId || !Number.isSafeInteger(launch.deploymentGeneration)
      || !Number.isFinite(context.startedAt)) return null;
    const all = this.hub.recoverablePeerTransports();
    const pinned: RuntimeTransportSnapshot[] = [];
    for (let index = 0; index < stages.length; index++) {
      const source = stages[index]!, destination = stages[(index + 1) % stages.length]!;
      const port = index === stages.length - 1 ? root.returnEndpoint.port : destination.anchor.endpoint.port;
      const matches = all.filter(stream => stream.sourceNodeId === source.anchor.memberId
        && stream.destinationNodeId === destination.anchor.memberId && stream.targetPort === port
        && stream.createdAt >= context.startedAt);
      if (matches.length !== 1 || matches[0]!.state !== "active") return null;
      pinned.push({ ...matches[0]! });
    }
    const current = () => this.prepared.get(modelId) === baseline && context.isCurrent();
    const inspect = async (): Promise<"ready" | "recovering" | "invalid"> => {
      if (!current()) return "invalid";
      const owners = await this.ownerState(baseline);
      if (owners === "invalid") return owners;
      const observed = this.hub.recoverablePeerTransports();
      let recovering = owners === "recovering";
      for (const original of pinned) {
        const sameId = observed.filter(stream => stream.streamId === original.streamId);
        if (sameId.length !== 1) return "invalid";
        const stream = sameId[0]!;
        if (stream.sourceNodeId !== original.sourceNodeId || stream.destinationNodeId !== original.destinationNodeId
          || stream.targetPort !== original.targetPort || stream.mode !== original.mode
          || stream.createdAt !== original.createdAt || stream.endedAt !== null
          || (stream.state !== "active" && stream.state !== "suspended")) return "invalid";
        recovering ||= stream.state === "suspended";
      }
      return recovering ? "recovering" : "ready";
    };
    return {
      isCurrent: current,
      inspect: async signal => {
        if (signal.aborted) return "invalid";
        const before = await inspect();
        if (before !== "ready") return before;
        const health = await context.inspectRoot(signal);
        // Async probes cannot authorize replacement owners or stale launches.
        if (signal.aborted) return "invalid";
        const after = await inspect();
        if (after === "invalid" || health === "invalid") return "invalid";
        return after === "recovering" || health === "recovering" ? "recovering" : "ready";
      },
    };
  }

  private async owner(nodeId: string): Promise<Owner | null> {
    const matches = (await this.store.listWorkers()).filter(worker => worker.capabilities.distributedExecutor?.nodeId === nodeId);
    if (matches.length !== 1) return null;
    const worker = matches[0]!, executor = worker.capabilities.distributedExecutor;
    const build = nativeBuildIdentitySchema.safeParse(worker.capabilities.buildIdentity);
    const auth = await this.hub.authenticatedWorkerAuthority(worker.id);
    if (worker.identityKind !== "device" || executor?.protocol !== "gdlp-worker-tunnel/2"
      || executor.streamRecovery !== "offset-ack-v1" || !build.success
      || build.data.version !== worker.capabilities.agentVersion || !this.hub.isConnected(worker.id)
      || !auth || auth.identityKind !== "device" || auth.workerId !== worker.id || auth.identityId !== worker.identityId) return null;
    return { nodeId, workerId: worker.id, identityId: auth.identityId, authority: authorityKey(auth),
      source: JSON.stringify([build.data.schema, build.data.version, build.data.sourceId, worker.capabilities.agentVersion]) };
  }

  private async ownerState(baseline: Baseline): Promise<"ready" | "recovering" | "invalid"> {
    let recovering = false;
    const workers = (await this.store.listWorkers());
    for (const original of baseline.owners) {
      const matches = workers.filter(worker => worker.capabilities.distributedExecutor?.nodeId === original.nodeId);
      if (matches.length !== 1 || matches[0]!.id !== original.workerId) return "invalid";
      const worker = matches[0]!, executor = worker.capabilities.distributedExecutor;
      const build = nativeBuildIdentitySchema.safeParse(worker.capabilities.buildIdentity);
      if (!build.success || worker.identityKind !== "device" || worker.identityId !== original.identityId || executor?.protocol !== "gdlp-worker-tunnel/2"
        || executor.streamRecovery !== "offset-ack-v1"
        || JSON.stringify([build.data.schema, build.data.version, build.data.sourceId, worker.capabilities.agentVersion]) !== original.source) return "invalid";
      if (!this.hub.isConnected(original.workerId)) { recovering = true; continue; }
      const auth = await this.hub.authenticatedWorkerAuthority(original.workerId);
      if (!auth || authorityKey(auth) !== original.authority) return "invalid";
    }
    return recovering ? "recovering" : "ready";
  }
}
function authorityKey(auth: AuthorizedWorkerSession): string {
  return JSON.stringify([auth.workerId, auth.identityKind, auth.identityId, auth.credentialFingerprint, auth.generation]);
}
