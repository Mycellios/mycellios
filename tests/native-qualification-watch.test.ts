import { describe, expect, it } from "vitest";
import { nativeTargetsNeedingRefresh, reserveNativeQualificationAttempt } from "../src/coordinator/native-qualification-watch.js";
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
