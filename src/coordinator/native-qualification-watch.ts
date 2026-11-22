import { readFile, writeFile, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_EXECUTIONS, MEMORY_EMBEDDING_MODEL, approvedMemoryEmbeddingExecution } from "../contracts/memory-embedding.js";

const sha256Ref = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const target = z.object({ workerId: z.string().min(1).max(256), deploymentId: z.string().min(1).max(256),
  activationId: z.string().min(1).max(256), modelDigest: sha256Ref,
  buildSourceId: sha256Ref, physicalNodeId: z.string().min(1).max(256) }).strict();
/**
 * Model-bound automatic approval for operator memory embeddings
 * (specs/memory-embedding-qwen06/spec.md, "Automatic node replicas"). Native
 * nodes start the replica by themselves, so their worker, activation and
 * physical node ids are not known in advance. The operator instead approves
 * the pinned model and artifact identity (both literals, so a new artifact is
 * never approved implicitly), the owner account whose nodes may serve it, the
 * exact node build sources (source drift still needs a new approval) and the
 * measured device/precision pairs. Every candidate still passes the same
 * three-sample canary gate.
 */
const memoryEmbeddingPolicy = z.object({
  model: z.literal(MEMORY_EMBEDDING_MODEL),
  modelDigest: z.literal(MEMORY_EMBEDDING_DIGEST),
  ownerAccountId: z.string().min(1).max(256),
  buildSourceIds: z.array(sha256Ref).min(1).max(8),
  executions: z.array(z.object({ backend: z.string().min(1).max(32), precision: z.string().min(1).max(32) }).strict()
    .refine(pair => MEMORY_EMBEDDING_EXECUTIONS.some(approved => approved.backend === pair.backend && approved.precision === pair.precision),
      { message: "memory embedding execution is not a measured pair" })).min(1).max(4),
  maxWorkers: z.number().int().min(1).max(16).default(8),
}).strict();
export const nativeQualificationAllowlistSchema = z.object({ targets: z.array(target).max(4).default([]),
  memoryEmbedding: memoryEmbeddingPolicy.optional() }).strict();
type Target = z.infer<typeof target>;
const attemptSchema = z.object({ count: z.number().int().min(0).max(3), since: z.number().int().nonnegative(), next: z.number().int().nonnegative() }).strict();
const journalSchema = z.object({ schema: z.literal("mycellios-native-qualification-attempts/1"),
  attempts: z.array(attemptSchema.extend({ workerId: z.string().min(1).max(256) }).strict()).max(20) }).strict();
export function reserveNativeQualificationAttempt(prior: z.infer<typeof attemptSchema> | undefined, now: number): z.infer<typeof attemptSchema> | null {
  if (prior && now - prior.since < 86_400_000 && (prior.count >= 3 || now < prior.next)) return null;
  const state = prior && now - prior.since < 86_400_000 ? prior : { count: 0, since: now, next: 0 };
  return { count: state.count + 1, since: state.since, next: now + 15 * 60_000 };
}
/**
 * The daily cap and backoff bound failed and uncertain attempts. A confirmed qualification clears
 * them: a coordinator restart drops every session's proof, and several deploys a day must not use
 * up the refreshes that the cap keeps for holding back a failure loop.
 */
export function settleNativeQualificationAttempt(state: z.infer<typeof attemptSchema>, httpStatus: number | null): z.infer<typeof attemptSchema> | undefined {
  return httpStatus !== null && httpStatus >= 200 && httpStatus < 300 ? undefined : state;
}
type Execution = { deviceType: string; backend?: string; precision?: string; deviceName?: string; fallback: boolean;
  stages?: Array<{ nodeId: string; deviceType?: string; backend?: string; precision?: string; fallback?: boolean }> };
interface WorkerObservation { id: string; connected: boolean; status: string; authenticatedSessionId?: string;
  ownerAccountId?: string | null; buildIdentity?: { sourceId: string };
  deployments: Array<{ deploymentId: string; adapter?: string; model?: string; activationId?: string;
    modelDigest: string; freeSlots: number; nativeReplicaEvidence?: { sessionId: string; observedAt: number;
      buildSourceId: string; activationId: string; physicalNodeId: string; modelDigest: string };
    execution?: Execution }> }

/** Memory embedding replicas that the model-bound policy approves right now, at most `maxWorkers`. */
export function memoryEmbeddingTargets(policy: z.infer<typeof memoryEmbeddingPolicy> | undefined, workers: WorkerObservation[]): Target[] {
  if (!policy) return [];
  const targets: Target[] = [];
  for (const w of [...workers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const buildSourceId = w.buildIdentity?.sourceId;
    if (!w.connected || w.status !== "online" || !w.authenticatedSessionId || w.ownerAccountId !== policy.ownerAccountId
      || !buildSourceId || !policy.buildSourceIds.includes(buildSourceId)) continue;
    for (const d of w.deployments) {
      const execution = d.adapter === "embedding" && d.model === policy.model && d.modelDigest === policy.modelDigest
        ? approvedMemoryEmbeddingExecution(d.execution as never) : null;
      if (!execution || !d.activationId || !policy.executions.some(pair => pair.backend === execution.backend && pair.precision === execution.precision)) continue;
      targets.push({ workerId: w.id, deploymentId: d.deploymentId, activationId: d.activationId, modelDigest: d.modelDigest,
        buildSourceId, physicalNodeId: d.execution!.stages![0]!.nodeId });
      break;
    }
    if (targets.length >= policy.maxWorkers) break;
  }
  return targets;
}

/** Explicit tuples plus the memory embedding replicas the model-bound policy approves. */
export function approvedNativeTargets(allowlist: unknown, workers: WorkerObservation[]): Target[] {
  const parsed = nativeQualificationAllowlistSchema.parse(allowlist);
  const automatic = memoryEmbeddingTargets(parsed.memoryEmbedding, workers)
    .filter(a => !parsed.targets.some(t => t.workerId === a.workerId && t.deploymentId === a.deploymentId));
  return [...parsed.targets, ...automatic];
}

/** No new model, activation, build or physical node is implicitly approved after a reconnect. */
export function nativeTargetsNeedingRefresh(allowlist: unknown, workers: WorkerObservation[], now: number): Target[] {
  return approvedNativeTargets(allowlist, workers).filter(t => {
    const w = workers.find(w => w.id === t.workerId), d = w?.deployments.find(d => d.deploymentId === t.deploymentId);
    // Native replicas qualify on one GPU stage; memory embeddings also admit their measured CPU fp32 stage.
    const device = d && d.model === MEMORY_EMBEDDING_MODEL && d.modelDigest === MEMORY_EMBEDDING_DIGEST
      && approvedMemoryEmbeddingExecution(d.execution as never)?.backend === "cpu" ? "cpu" : "gpu";
    if (!w?.connected || w.status !== "online" || !w.authenticatedSessionId || w.buildIdentity?.sourceId !== t.buildSourceId
      || d?.activationId !== t.activationId || d.modelDigest !== t.modelDigest || d.freeSlots < 1
      || d.execution?.deviceType !== device || d.execution.fallback || d.execution.stages?.length !== 1
      || d.execution.stages[0]!.nodeId !== t.physicalNodeId) return false;
    const e = d.nativeReplicaEvidence;
    return !e || e.sessionId !== w.authenticatedSessionId || e.buildSourceId !== t.buildSourceId
      || e.activationId !== t.activationId || e.modelDigest !== t.modelDigest || e.physicalNodeId !== t.physicalNodeId
      || e.observedAt > now || now - e.observedAt > 6 * 24 * 60 * 60_000;
  });
}

export async function runNativeQualificationWatch(path: string): Promise<never> {
  const network = process.env.MYCELLIOS_NETWORK_TOKEN, admin = process.env.MYCELLIOS_MODEL_ADMIN_TOKEN;
  if (!network || !admin) throw new Error("native_qualification_watch_credentials_missing");
  const headers = { authorization: `Bearer ${network}`, "x-mycellios-admin-token": admin, "content-type": "application/json" };
  // Loopback by default; a sidecar on the coordinator's network sets its service URL
  // so it does not have to share (and lose) the coordinator container's namespace.
  const base = (process.env.MYCELLIOS_COORDINATOR_INTERNAL_URL ?? "http://127.0.0.1:4174").replace(/\/+$/, "");
  if (!/^http:\/\/[a-z0-9.-]+:\d+$/i.test(base)) throw new Error("native_qualification_watch_coordinator_url_invalid");
  const journalPath = path + ".attempts.json";
  const saved: unknown = await readFile(journalPath, "utf8").then(value => JSON.parse(value)).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: "mycellios-native-qualification-attempts/1", attempts: [] };
    throw error;
  });
  const failures = new Map(journalSchema.parse(saved).attempts.map(({ workerId, ...state }) => [workerId, state]));
  for (;;) {
    try {
      const allowlist: unknown = JSON.parse(await readFile(path, "utf8"));
      const snapshot = await fetch(`${base}/internal/v1/workers`, { headers, signal: AbortSignal.timeout(10_000) });
      if (!snapshot.ok) throw new Error("native_qualification_watch_snapshot_failed");
      const workers = (await snapshot.json() as { data: WorkerObservation[] }).data;
      for (const t of nativeTargetsNeedingRefresh(allowlist, workers, Date.now())) {
        const state = reserveNativeQualificationAttempt(failures.get(t.workerId), Date.now());
        if (!state) continue;
        // Reserve the attempt before sending. A timeout is uncertain and never retried in this cycle.
        failures.set(t.workerId, state);
        const approved = new Set(approvedNativeTargets(allowlist, workers).map(value => value.workerId));
        const persist = async () => {
          const journal = { schema: "mycellios-native-qualification-attempts/1", attempts: [...failures]
            // An automatic replica that briefly disconnects keeps its daily cap across a watch restart.
            .filter(([id, value]) => approved.has(id) || Date.now() - value.since < 86_400_000)
            .sort(([, a], [, b]) => b.since - a.since).slice(0, 20).map(([workerId, value]) => ({ workerId, ...value })) };
          const temporary = journalPath + `.${process.pid}.tmp`;
          await writeFile(temporary, JSON.stringify(journalSchema.parse(journal)), { mode: 0o600 });
          await rename(temporary, journalPath);
        };
        await persist();
        let httpStatus: number | null = null;
        try {
          const response = await fetch(`${base}/internal/v1/native-replica-qualifications`, {
            method: "POST", headers, body: JSON.stringify({ workerId: t.workerId, deploymentId: t.deploymentId }),
            signal: AbortSignal.timeout(480_000),
          });
          await response.body?.cancel();
          httpStatus = response.status;
          console.log(JSON.stringify({ phase: "native_qualification_refresh", workerId: t.workerId, http: response.status }));
        } catch { console.log(JSON.stringify({ phase: "native_qualification_refresh_uncertain", workerId: t.workerId })); }
        if (!settleNativeQualificationAttempt(state, httpStatus)) {
          failures.delete(t.workerId);
          await persist();
        }
      }
    } catch { console.log(JSON.stringify({ phase: "native_qualification_watch_unavailable" })); }
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error("native_qualification_allowlist_path_required");
  await runNativeQualificationWatch(file);
}
