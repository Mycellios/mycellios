import { afterEach, describe, expect, it } from "vitest";
import { DesktopRelayBroker, desktopRelayKey, signDesktopRelay, verifyDesktopRelay } from "./desktop-relay.js";
const owner = { userId: "user", spaceId: "space", sessionId: "session" };
const binding = { deviceId: "device", botId: "bot", generation: "generation" };
const context = () => ({ userId: "user", spaceId: "space", botId: "bot", operationId: "op", traceId: "trace", signal: new AbortController().signal });
let broker: DesktopRelayBroker;
afterEach(() => broker?.close());
describe("outbound Desktop relay", () => {
  it("binds and routes only the exact account, space, session and device", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    expect(broker.available({ ...owner, spaceId: "other" }, "bot")).toBe(false);
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    expect(broker.poll({ ...owner, sessionId: "other" }, "device").operations).toEqual([]);
    const state = broker.poll(owner, "device");
    expect(state.operations).toHaveLength(1);
    expect(broker.poll(owner, "device").operations).toEqual([]);
    const id = state.operations[0]!.id;
    expect(() => broker.result({ ...owner, userId: "attacker" }, "device", id, 0, "", true)).toThrow();
    broker.result(owner, "device", id, 0, Buffer.from('{"value":1}\n{"done":true}\n').toString("base64"), true);
    expect(await response.text()).toContain('"value":1');
  });
  it("never reclaims commands after a lost poll, and deduplicates result acknowledgement", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "execute", botId: "bot", command: { argv: ["test"] } }, context());
    const id = broker.poll(owner, "device").operations[0]!.id;
    expect(broker.poll(owner, "device")).toEqual({ operations: [], active: [id] });
    const data = Buffer.from('{"done":true}\n').toString("base64");
    broker.result(owner, "device", id, 0, data, true); broker.result(owner, "device", id, 0, data, true);
    expect(await response.text()).toBe('{"done":true}\n');
    expect(() => broker.result(owner, "device", id, 0, "", true)).toThrow();
  });
  it("does not stop a quiet long command while authenticated Desktop heartbeats continue", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "execute", botId: "bot", command: { argv: ["render"], timeoutMs: 3_600_000 } }, context());
    const id = broker.poll(owner, "device").operations[0]!.id;
    for (let i = 0; i < 400; i++) { now += 30_000; expect(broker.poll(owner, "device").active).toEqual([id]); }
    broker.result(owner, "device", id, 0, Buffer.from('{"done":true}\n').toString("base64"), true);
    expect(await response.text()).toContain("done");
  });
  it("expires disconnected work and never moves an active agent to a different PC", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    expect(() => broker.bind(owner, { ...binding, deviceId: "other" })).toThrow();
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    now = 46_000;
    expect(broker.available(owner, "bot")).toBe(false);
    expect(await response.text()).toContain("disconnected");
    expect(() => broker.dispatch({ method: "environment", botId: "bot" }, context())).toThrow();
  });
  it("revokes and cancels the exact device without cancelling another agent", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    broker.bind(owner, { ...binding, botId: "other", deviceId: "other-device" });
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    broker.revoke(owner, "device");
    expect(await response.text()).toContain("revoked");
    expect(broker.available(owner, "other")).toBe(true);
  });
  it("does not resume an old run against a newly selected project generation", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "environment", botId: "bot", runId: "original-run" }, context());
    broker.revoke(owner, "device"); await response.text();
    broker.bind(owner, { ...binding, generation: "replacement" });
    expect(() => broker.dispatch({ method: "environment", botId: "bot", runId: "original-run" }, context())).toThrow("previous project");
  });
  it("authenticates internal scope and body using a purpose-specific key and freshness", () => {
    const key = desktopRelayKey("operator-secret"); const timestamp = String(Date.now());
    const signature = signDesktopRelay(key, timestamp, "body");
    expect(verifyDesktopRelay(key, timestamp, "body", signature)).toBe(true);
    expect(verifyDesktopRelay(key, timestamp, "altered", signature)).toBe(false);
    expect(verifyDesktopRelay("operator-secret", timestamp, "body", signature)).toBe(false);
    expect(verifyDesktopRelay(key, timestamp, "body", signature, Date.now() + 60_000)).toBe(false);
  });
});
