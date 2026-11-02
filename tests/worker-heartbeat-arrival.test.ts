import { describe, expect, it, vi } from "vitest";
import { WorkerHub } from "../src/coordinator/worker-hub.js";
import { workerHeartbeatArrival, workerConnectionIsHeartbeatStale, type ConnectionState } from "../src/coordinator/worker-connection-state.js";
import { workerHeartbeatEnvelopeSchema } from "../src/contracts/worker-protocol.js";

function fixture() {
  const state = { workerId: "worker", ready: true, closed: false,
    socket: { readyState: 1, OPEN: 1 } } as unknown as ConnectionState;
  const frame = workerHeartbeatEnvelopeSchema.parse({ v: 1, workerId: "worker", type: "worker.heartbeat",
    payload: {
      heartbeat: { draining: false, pausedReason: null, activeLeases: [], gpus: [], deployments: [],
        network: { coordinatorRttMs: 10, uplinkMbps: 100 } },
      capabilities: { region: "test", agentVersion: "test", gpus: [{ id: "gpu", vendor: "test", model: "test",
        physicalVramMb: 8192, offeredVramMb: 4096, freeOfferedVramMb: 4096 }],
        limits: { maxConcurrency: 1, pauseWhenForeground: false }, deployments: [],
        network: { coordinatorRttMs: 10, uplinkMbps: 100, downlinkMbps: 100 } },
      metrics: { ready: true, activeJobs: 0, loadedModels: [] },
    } });
  return { state, raw: JSON.stringify(frame) };
}

describe("validated worker heartbeat arrival", () => {
  it("records arrival before a backlogged inbound queue processes the frame", () => {
    const { state, raw } = fixture();
    const times = new WeakMap<ConnectionState, number>(), enqueue = vi.fn();
    const harness = { connections: new Map([["worker", state]]), validatedHeartbeatTimes: times,
      inboundFrames: { enqueue } };
    const receive = (WorkerHub.prototype as unknown as {
      receiveRawMessage(state: ConnectionState, raw: string): void;
    }).receiveRawMessage;
    receive.call(harness, state, raw);
    expect(enqueue).toHaveBeenCalledWith(state, raw);
    const arrived = times.get(state)!;
    expect(arrived).toBeGreaterThan(0);
    const worker = { status: "offline" as const, lastSeenAt: arrived - 60_000 };
    expect(workerConnectionIsHeartbeatStale(worker, arrived + 1_000, arrived)).toBe(false);
    expect(workerConnectionIsHeartbeatStale(worker, arrived + 10_001, arrived)).toBe(true);
    expect(workerConnectionIsHeartbeatStale(worker, arrived, arrived + 1)).toBe(true);
  });

  it("never extends liveness for another connection, a wrong worker or an invalid frame", () => {
    const { state, raw } = fixture();
    expect(workerHeartbeatArrival(state, raw, { ...state }, 100)).toBeUndefined();
    expect(workerHeartbeatArrival(state, raw.replace('"workerId":"worker"', '"workerId":"other"'), state, 100)).toBeUndefined();
    expect(workerHeartbeatArrival(state, '{"type":"worker.heartbeat"}', state, 100)).toBeUndefined();
    expect(workerHeartbeatArrival(state, " ".repeat(2_200_001), state, 100)).toBeUndefined();
    state.closed = true;
    expect(workerHeartbeatArrival(state, raw, state, 100)).toBeUndefined();
  });
});
