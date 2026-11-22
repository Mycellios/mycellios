import { describe, expect, it } from "vitest";
import { approvedNativeTargets, nativeTargetsNeedingRefresh, reserveNativeQualificationAttempt, settleNativeQualificationAttempt } from "../src/coordinator/native-qualification-watch.js";
import { MEMORY_EMBEDDING_DIGEST, MEMORY_EMBEDDING_MODEL } from "../src/contracts/memory-embedding.js";
const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const t = { workerId: "w", deploymentId: "d", activationId: "a", modelDigest: digest, buildSourceId: digest, physicalNodeId: "n" };
  const w = { id: "w", connected: true, status: "online", authenticatedSessionId: "session", buildIdentity: { sourceId: digest },
    deployments: [{ deploymentId: "d", activationId: "a", modelDigest: digest, freeSlots: 1,
      execution: { deviceType: "gpu", fallback: false, stages: [{ nodeId: "n" }] } }] };
  return { allowlist: { targets: [t] }, workers: [w], t, w };
}
describe("native qualification refresh approval", () => {
  it("retains the daily limit and uncertain-request backoff after a persisted journal is reloaded", () => {
    let state = reserveNativeQualificationAttempt(undefined, 1_000)!;
    expect(reserveNativeQualificationAttempt(state, 2_000)).toBeNull();
    state = reserveNativeQualificationAttempt(state, 901_000)!;
    state = reserveNativeQualificationAttempt(state, 1_801_000)!;
    const reloaded = JSON.parse(JSON.stringify(state));
    expect(reserveNativeQualificationAttempt(reloaded, 2_701_000)).toBeNull();
    expect(reserveNativeQualificationAttempt(reloaded, 86_402_000)?.count).toBe(1);
  });
  it("clears the cap after a confirmed qualification but keeps it for failed and uncertain attempts", () => {
    let state = reserveNativeQualificationAttempt(undefined, 1_000)!;
    for (const now of [901_000, 1_801_000]) state = reserveNativeQualificationAttempt(state, now)!;
    expect(state.count).toBe(3);
    for (const status of [422, 502, null]) expect(settleNativeQualificationAttempt(state, status)).toEqual(state);
    // Every coordinator restart drops the proof; a confirmed refresh leaves the next one available.
    const cleared = settleNativeQualificationAttempt(state, 200);
    expect(cleared).toBeUndefined();
    expect(reserveNativeQualificationAttempt(cleared, 2_701_000)?.count).toBe(1);
  });
  it("refreshes an approved idle physical replica after its session lost evidence", () => {
    const f = fixture(); expect(nativeTargetsNeedingRefresh(f.allowlist, f.workers, 1000)).toEqual([f.t]);
  });
  it("does not approve drifted builds, activations, models, physical nodes, paused or occupied workers", () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.w.buildIdentity.sourceId = `sha256:${"b".repeat(64)}`; },
      (f: ReturnType<typeof fixture>) => { f.w.deployments[0]!.activationId = "other"; },
      (f: ReturnType<typeof fixture>) => { f.w.deployments[0]!.modelDigest = `sha256:${"c".repeat(64)}`; },
      (f: ReturnType<typeof fixture>) => { f.w.deployments[0]!.execution.stages[0]!.nodeId = "other"; },
      (f: ReturnType<typeof fixture>) => { f.w.status = "draining"; },
      (f: ReturnType<typeof fixture>) => { f.w.deployments[0]!.freeSlots = 0; },
    ]) { const f = fixture(); mutate(f); expect(nativeTargetsNeedingRefresh(f.allowlist, f.workers, 1000)).toEqual([]); }
  });
  it("does not repeat fresh proof and rejects a broadened allowlist", () => {
    const f = fixture();
    const workers = [{ ...f.w, deployments: [{ ...f.w.deployments[0]!, nativeReplicaEvidence: { ...f.t, sessionId: "session", observedAt: 900 } }] }];
    expect(nativeTargetsNeedingRefresh(f.allowlist, workers, 1000)).toEqual([]);
    expect(() => nativeTargetsNeedingRefresh({ targets: [f.t], anyModel: true }, workers, 1000)).toThrow();
  });
});

describe("model-bound automatic approval for memory embedding replicas", () => {
  const BUILD = `sha256:${"b".repeat(64)}`;
  const policy = (extra: Record<string, unknown> = {}) => ({ memoryEmbedding: { model: MEMORY_EMBEDDING_MODEL, modelDigest: MEMORY_EMBEDDING_DIGEST,
    ownerAccountId: "account-a", buildSourceIds: [BUILD], executions: [{ backend: "cuda", precision: "float16" }, { backend: "cpu", precision: "float32" }], ...extra } });
  const stage = (backend: string, precision: string, nodeId = "node-1") => ({ nodeId, stageIndex: 0, layerStart: 0, layerEnd: 28,
    deviceType: backend === "cpu" ? "cpu" : "gpu", backend, deviceName: "device", precision, fallback: false });
  const node = (id: string, overrides: { owner?: string | null; build?: string; backend?: string; precision?: string; digest?: string; evidence?: unknown } = {}) => {
    const backend = overrides.backend ?? "cuda", precision = overrides.precision ?? "float16";
    return { id, connected: true, status: "online", authenticatedSessionId: `session-${id}`, ownerAccountId: overrides.owner === undefined ? "account-a" : overrides.owner,
      buildIdentity: { sourceId: overrides.build ?? BUILD },
      deployments: [{ deploymentId: `dep-${id}`, adapter: "embedding", model: MEMORY_EMBEDDING_MODEL, modelDigest: overrides.digest ?? MEMORY_EMBEDDING_DIGEST,
        activationId: `act-${id}`, freeSlots: 1, ...(overrides.evidence ? { nativeReplicaEvidence: overrides.evidence } : {}),
        execution: { deviceType: backend === "cpu" ? "cpu" : "gpu", backend, deviceName: "device", precision, fallback: false, stages: [stage(backend, precision, `node-${id}`)] } }] };
  };

  it("qualifies an owner's new replica on an approved build and measured pair, including CPU fp32", () => {
    const targets = nativeTargetsNeedingRefresh(policy(), [node("gpu"), node("cpu", { backend: "cpu", precision: "float32" })] as never, 1_000);
    expect(targets).toEqual([
      { workerId: "cpu", deploymentId: "dep-cpu", activationId: "act-cpu", modelDigest: MEMORY_EMBEDDING_DIGEST, buildSourceId: BUILD, physicalNodeId: "node-cpu" },
      { workerId: "gpu", deploymentId: "dep-gpu", activationId: "act-gpu", modelDigest: MEMORY_EMBEDDING_DIGEST, buildSourceId: BUILD, physicalNodeId: "node-gpu" },
    ]);
  });

  it("never approves another owner, a drifted build, an unlisted pair or another artifact", () => {
    for (const worker of [
      node("other-owner", { owner: "account-b" }),
      node("no-owner", { owner: null }),
      node("drifted", { build: `sha256:${"c".repeat(64)}` }),
      node("unlisted", { backend: "directml", precision: "float32" }),
      node("refused-pair", { backend: "directml", precision: "float16" }),
      node("other-artifact", { digest: `sha256:${"d".repeat(64)}` }),
    ]) expect(approvedNativeTargets(policy(), [worker] as never)).toEqual([]);
  });

  it("does not repeat fresh proof and caps the number of automatic replicas", () => {
    const fresh = node("fresh", { evidence: { sessionId: "session-fresh", observedAt: 900, buildSourceId: BUILD, activationId: "act-fresh",
      physicalNodeId: "node-fresh", modelDigest: MEMORY_EMBEDDING_DIGEST } });
    expect(nativeTargetsNeedingRefresh(policy(), [fresh] as never, 1_000)).toEqual([]);
    const many = Array.from({ length: 5 }, (_, index) => node(`n${index}`));
    expect(approvedNativeTargets(policy({ maxWorkers: 2 }), many as never).map((target) => target.workerId)).toEqual(["n0", "n1"]);
  });

  it("rejects a policy that widens the pinned model, artifact or measured pairs", () => {
    for (const widened of [
      policy({ modelDigest: `sha256:${"e".repeat(64)}` }),
      policy({ model: "mycellios-qwen3-embedding-4b" }),
      policy({ executions: [{ backend: "directml", precision: "float16" }] }),
      policy({ executions: [{ backend: "rocm", precision: "float16" }] }),
      policy({ buildSourceIds: [] }),
      policy({ anyBuild: true }),
    ]) expect(() => approvedNativeTargets(widened, [])).toThrow();
  });
});
