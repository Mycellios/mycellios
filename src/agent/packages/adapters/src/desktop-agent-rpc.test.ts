import { expect, it } from "vitest";
import { DesktopAgentRpc } from "./desktop-agent-rpc.js";

const rpc = () => new DesktopAgentRpc(() => undefined);

it("carries a Date across the bridge as the same instant", () => {
  const bridge = rpc();
  const at = new Date("2026-11-22T21:30:00.000Z");
  const decoded = bridge.decode(JSON.parse(JSON.stringify(bridge.encode({ scheduledFor: at, list: [at] })))) as { scheduledFor: Date; list: Date[] };
  expect(decoded.scheduledFor).toBeInstanceOf(Date);
  expect(decoded.scheduledFor.toISOString()).toBe(at.toISOString());
  expect(decoded.list[0]!.getTime()).toBe(at.getTime());
});

it("refuses an invalid Date and a malformed date on the wire", () => {
  const bridge = rpc();
  expect(() => bridge.encode({ at: new Date(Number.NaN) })).toThrow("Unsupported Desktop runtime value (Date at .at)");
  expect(() => bridge.decode({ kind: "date", value: "not a date" })).toThrow("Invalid Desktop runtime value");
});

it("names the unsupported type and key path, never the value", () => {
  const bridge = rpc();
  const controller = new AbortController();
  const secret = "sk-very-secret";
  const failure = (() => {
    try { bridge.encode(["shell", { command: secret }, "id", undefined, { yieldSignal: controller.signal }]); }
    catch (error) { return error as Error; }
  })();
  expect(failure?.message).toBe("Unsupported Desktop runtime value (AbortSignal at [4].yieldSignal)");
  expect(() => bridge.encode({ [secret + " key"]: new Map() })).toThrow("Unsupported Desktop runtime value (Map at [?])");
  expect(() => bridge.encode({ n: Number.POSITIVE_INFINITY })).toThrow("Unsupported Desktop runtime value (number at .n)");
  expect(() => bridge.encode(new URL("https://example.com/private"))).toThrow("Unsupported Desktop runtime value (URL at root)");
  expect(failure?.message).not.toContain(secret);
});
