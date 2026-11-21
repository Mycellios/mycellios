import { describe, expect, it } from "vitest";
import { desktopDiagnosticMessage } from "@rakazo/contracts";
import { busyBeforeDispatch, sendWhenPcHasRoom } from "./desktop-callback-wait.js";

const busy = () => Error(desktopDiagnosticMessage({ code: "desktop_busy", phase: "callback", stage: "dispatch" }));

describe("callbacks to a full PC queue", () => {
  it("waits for room when the relay refused before dispatch", async () => {
    let calls = 0;
    await sendWhenPcHasRoom(async () => { if (++calls < 3) throw busy(); }, "run", new AbortController().signal);
    expect(calls).toBe(3);
  });
  it("never resends after any other failure", async () => {
    let calls = 0;
    const failure = Error(desktopDiagnosticMessage({ code: "desktop_disconnected", phase: "callback", stage: "native_stream" }));
    await expect(sendWhenPcHasRoom(async () => { calls++; throw failure; }, "run", new AbortController().signal)).rejects.toBe(failure);
    expect(calls).toBe(1);
    expect(busyBeforeDispatch(failure)).toBe(false);
  });
  it("gives up after its wait and when the run stops", async () => {
    await expect(sendWhenPcHasRoom(async () => { throw busy(); }, "run", new AbortController().signal, 600)).rejects.toThrow(/desktop_busy/);
    const stopped = new AbortController(); stopped.abort();
    let calls = 0;
    await expect(sendWhenPcHasRoom(async () => { calls++; throw busy(); }, "run", stopped.signal)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("recognizes the in-process relay refusal", () => {
    expect(busyBeforeDispatch(Object.assign(Error("The PC request queue is full."), { code: "desktop_busy" }))).toBe(true);
  });
});
