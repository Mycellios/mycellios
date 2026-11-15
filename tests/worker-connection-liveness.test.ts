import WebSocket from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workerConfigSchema } from "../src/contracts/schemas.js";
import { WorkerAgent } from "../src/worker/agent.js";

describe("worker connection liveness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("terminates a silent open socket after the grace period so normal reconnect can run", async () => {
    const { harness, socket, advance } = setup();
    harness.startRttProbe(socket as unknown as WebSocket);
    await advance(44_999);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    await advance(60_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("accepts a delayed pong without confusing it with a newer ping", async () => {
    const { agent, harness, socket, advance } = setup();
    harness.startRttProbe(socket as unknown as WebSocket);
    await advance(20_000);
    harness.recordRttSample(socket.ping.mock.calls[0]![0]);
    expect(agent.measuredRttMs).toBe(20_000);
    await advance(10_000);
    expect(socket.ping).toHaveBeenCalledTimes(2);
    await advance(100);
    harness.recordRttSample(socket.ping.mock.calls[1]![0]);
    expect(agent.measuredRttMs).toBe(100);
    expect(socket.terminate).not.toHaveBeenCalled();
    harness.stopRttProbe();
  });

  it("does not let an unrelated pong keep a dead transport alive", async () => {
    const { harness, socket, advance } = setup();
    harness.startRttProbe(socket as unknown as WebSocket);
    await advance(30_000);
    harness.recordRttSample(Buffer.from("unrelated"));
    await advance(15_000);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });
});

function setup() {
  vi.useFakeTimers();
  const startedAt = Date.now();
  vi.spyOn(process.hrtime, "bigint").mockImplementation(() => BigInt(Date.now() - startedAt) * 1_000_000n);
  const agent = new WorkerAgent(workerConfigSchema.parse({
    region: "test",
    offeredVramMb: 4_096,
    limits: { maxConcurrency: 1, pauseWhenForeground: false },
    adapter: { kind: "mock", developmentOnly: true, model: "test", tokensPerSecond: 1_000, ttftMs: 0, failureRate: 0 },
    deployment: { modelDigest: "sha256:test", contextLimit: 8_192 },
  }), { coordinatorUrl: "http://127.0.0.1:8080", logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  const harness = agent as unknown as {
    startRttProbe(socket: WebSocket): void;
    stopRttProbe(): void;
    recordRttSample(payload: Buffer): void;
  };
  const socket = { readyState: WebSocket.OPEN, ping: vi.fn<(payload: Buffer) => void>(), terminate: vi.fn() };
  return {
    agent, harness, socket,
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
  };
}
