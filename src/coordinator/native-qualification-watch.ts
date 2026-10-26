import { readFile, writeFile, rename } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const target = z.object({ workerId: z.string().min(1).max(256), deploymentId: z.string().min(1).max(256),
  activationId: z.string().min(1).max(256), modelDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  buildSourceId: z.string().regex(/^sha256:[a-f0-9]{64}$/), physicalNodeId: z.string().min(1).max(256) }).strict();
export const nativeQualificationAllowlistSchema = z.object({ targets: z.array(target).max(4) }).strict();
type Target = z.infer<typeof target>;
const attemptSchema = z.object({ count: z.number().int().min(0).max(3), since: z.number().int().nonnegative(), next: z.number().int().nonnegative() }).strict();
const journalSchema = z.object({ schema: z.literal("mycellios-native-qualification-attempts/1"),
  attempts: z.array(attemptSchema.extend({ workerId: z.string().min(1).max(256) }).strict()).max(4) }).strict();
export function reserveNativeQualificationAttempt(prior: z.infer<typeof attemptSchema> | undefined, now: number): z.infer<typeof attemptSchema> | null {
  if (prior && now - prior.since < 86_400_000 && (prior.count >= 3 || now < prior.next)) return null;
  const state = prior && now - prior.since < 86_400_000 ? prior : { count: 0, since: now, next: 0 };
  return { count: state.count + 1, since: state.since, next: now + 15 * 60_000 };
}
interface WorkerObservation { id: string; connected: boolean; status: string; authenticatedSessionId?: string;
  buildIdentity?: { sourceId: string }; deployments: Array<{ deploymentId: string; activationId?: string;
    modelDigest: string; freeSlots: number; nativeReplicaEvidence?: { sessionId: string; observedAt: number;
      buildSourceId: string; activationId: string; physicalNodeId: string; modelDigest: string };
    execution?: { deviceType: string; fallback: boolean; stages?: Array<{ nodeId: string }> } }> }

/** No new model, activation, build or physical node is implicitly approved after a reconnect. */
export function nativeTargetsNeedingRefresh(allowlist: unknown, workers: WorkerObservation[], now: number): Target[] {
  return nativeQualificationAllowlistSchema.parse(allowlist).targets.filter(t => {
    const w = workers.find(w => w.id === t.workerId), d = w?.deployments.find(d => d.deploymentId === t.deploymentId);
    if (!w?.connected || w.status !== "online" || !w.authenticatedSessionId || w.buildIdentity?.sourceId !== t.buildSourceId
      || d?.activationId !== t.activationId || d.modelDigest !== t.modelDigest || d.freeSlots < 1
      || d.execution?.deviceType !== "gpu" || d.execution.fallback || d.execution.stages?.length !== 1
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
  const journalPath = path + ".attempts.json";
  const saved: unknown = await readFile(journalPath, "utf8").then(value => JSON.parse(value)).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: "mycellios-native-qualification-attempts/1", attempts: [] };
    throw error;
  });
  const failures = new Map(journalSchema.parse(saved).attempts.map(({ workerId, ...state }) => [workerId, state]));
  for (;;) {
    try {
      const allowlist: unknown = JSON.parse(await readFile(path, "utf8"));
      const snapshot = await fetch("http://127.0.0.1:4174/internal/v1/workers", { headers, signal: AbortSignal.timeout(10_000) });
      if (!snapshot.ok) throw new Error("native_qualification_watch_snapshot_failed");
      const workers = (await snapshot.json() as { data: WorkerObservation[] }).data;
      for (const t of nativeTargetsNeedingRefresh(allowlist, workers, Date.now())) {
        const state = reserveNativeQualificationAttempt(failures.get(t.workerId), Date.now());
        if (!state) continue;
        // Reserve the attempt before sending. A timeout is uncertain and never retried in this cycle.
        failures.set(t.workerId, state);
        const approved = new Set(nativeQualificationAllowlistSchema.parse(allowlist).targets.map(value => value.workerId));
        const journal = { schema: "mycellios-native-qualification-attempts/1", attempts: [...failures]
          .filter(([id]) => approved.has(id)).map(([workerId, value]) => ({ workerId, ...value })) };
        const temporary = journalPath + `.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify(journalSchema.parse(journal)), { mode: 0o600 });
        await rename(temporary, journalPath);
        try {
          const response = await fetch("http://127.0.0.1:4174/internal/v1/native-replica-qualifications", {
            method: "POST", headers, body: JSON.stringify({ workerId: t.workerId, deploymentId: t.deploymentId }),
            signal: AbortSignal.timeout(480_000),
          });
          await response.body?.cancel();
          console.log(JSON.stringify({ phase: "native_qualification_refresh", workerId: t.workerId, http: response.status }));
        } catch { console.log(JSON.stringify({ phase: "native_qualification_refresh_uncertain", workerId: t.workerId })); }
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
