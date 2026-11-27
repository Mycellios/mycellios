import { expect, it } from "vitest";
import { DesktopAgentRpc, oneWay } from "./desktop-agent-rpc.js";

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

it("sends notifications one-way only when both sides understand them", async () => {
  const toWorker: unknown[] = [];
  const toPc: unknown[] = [];
  const worker = new DesktopAgentRpc(message => { toPc.push(message); });
  const pc = new DesktopAgentRpc(message => { toWorker.push(message); });
  const saved: string[] = [];
  const wire = worker.encode({ onCheckpoint: worker.notify(async (blob: string) => { saved.push(blob); }) });
  expect(JSON.stringify(wire)).toContain('"mode":"notify"');
  const { onCheckpoint } = pc.decode(JSON.parse(JSON.stringify(wire))) as { onCheckpoint: (blob: string) => Promise<void> };
  // The PC does not wait for the worker: the call resolves as soon as it is sent.
  await onCheckpoint("transcript");
  expect(toWorker).toEqual([expect.objectContaining({ kind: "call", notify: true })]);
  await worker.accept(toWorker[0]);
  expect(saved).toEqual(["transcript"]);
  // No reply operation crosses back.
  expect(toPc).toEqual([]);
});

it("still replies to a caller that ignores the notification mode", async () => {
  const toPc: unknown[] = [];
  const worker = new DesktopAgentRpc(message => { toPc.push(message); });
  const wire = worker.encode({ done: worker.notify(() => undefined) }) as { kind: string; value: [string, { value: string }][] };
  const target = wire.value[0]![1].value;
  // An older Desktop sends an ordinary call and keeps waiting for its reply.
  await worker.accept({ kind: "call", id: "11111111-1111-4111-8111-111111111111", target, args: { kind: "array", value: [] } });
  expect(toPc).toEqual([expect.objectContaining({ kind: "result", failed: false })]);
});

it("refuses one-way calls to ordinary functions and reports a failed notification locally", async () => {
  const toPc: unknown[] = [];
  const worker = new DesktopAgentRpc(message => { toPc.push(message); });
  const wire = worker.encode({
    plain: () => "answer",
    broken: worker.notify(() => { throw Error("checkpoint not saved"); }),
  }) as { value: [string, { value: string }][] };
  const [plain, broken] = wire.value.map(([, handle]) => handle.value);
  const args = { kind: "array", value: [] };
  await expect(worker.accept({ kind: "call", id: "22222222-2222-4222-8222-222222222222", target: plain, args, notify: true }))
    .rejects.toThrow("Invalid Desktop runtime notification");
  await expect(worker.accept({ kind: "call", id: "33333333-3333-4333-8333-333333333333", target: broken, args, notify: true }))
    .rejects.toThrow("checkpoint not saved");
  expect(toPc).toEqual([]);
  expect(() => rpc().decode({ kind: "promise", value: plain, mode: "notify" })).toThrow("Invalid Desktop runtime value");
  expect(() => rpc().decode({ kind: "function", value: plain, mode: "other" })).toThrow("Invalid Desktop runtime value");
});

it("sends a function marked oneWay as a notification from any session", async () => {
  const toWorker: unknown[] = [];
  const toPc: unknown[] = [];
  const pc = new DesktopAgentRpc(message => { toWorker.push(message); });
  const worker = new DesktopAgentRpc(message => { toPc.push(message); });
  const received: number[] = [];
  const wire = pc.encode({ push: oneWay((seq: number) => { received.push(seq); }) });
  expect(JSON.stringify(wire)).toContain('"mode":"notify"');
  const { push } = worker.decode(JSON.parse(JSON.stringify(wire))) as { push: (seq: number) => Promise<void> };
  await push(1);
  expect(toPc).toEqual([expect.objectContaining({ kind: "call", notify: true })]);
  await pc.accept(toPc[0]);
  expect(received).toEqual([1]);
  expect(toWorker).toEqual([]);
});
