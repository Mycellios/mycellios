import { expect, it } from "vitest";
import {
  confirmDesktopCommandResult,
  isUnconfirmedCommandDelivery,
  UNCONFIRMED_COMMAND_RESULT,
} from "./desktop-command-confirmation.js";

const base = {
  runId: "run-1",
  toolName: "shell",
  commandId: "run-1:effect",
  startedAt: 1_000,
  signal: new AbortController().signal,
};

it("returns a saved exit without waiting or executing again", async () => {
  const reads: string[] = [];
  const logs: string[] = [];
  const outcome = await confirmDesktopCommandResult({
    ...base,
    now: () => 4_000,
    sleep: async () => { throw new Error("a saved result must not wait"); },
    log: (event, fields) => logs.push(`${event}:${fields["run.id"]}:${fields["tool.name"]}:${fields["desktop.command.id"]}:${fields["desktop.elapsed_ms"]}:${fields["desktop.exit_code"]}`),
    read: async () => {
      reads.push("status");
      return { runId: "run-1", state: "completed", exitCode: 0, stdout: "ok", stderr: "" };
    },
  });
  expect(outcome).toEqual({ confirmed: true, code: 0, stdout: "ok", stderr: "" });
  expect(reads).toEqual(["status"]);
  expect(logs).toEqual(["desktop.command.result_confirmed:run-1:shell:run-1:effect:3000:0"]);
});

it("waits until a later receipt is terminal and keeps the retained tail", async () => {
  let clock = 0;
  let polls = 0;
  const outcome = await confirmDesktopCommandResult({
    ...base,
    timeoutMs: 1_000,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    read: async () => {
      polls += 1;
      if (polls < 3) return { runId: "run-1", state: "running", exitCode: null, stdout: "partial", stderr: "" };
      return {
        runId: "run-1", state: "failed", exitCode: 2, stdout: "head", stderr: "err",
        stdoutTail: "tail", outputTruncated: true,
      };
    },
  });
  expect(polls).toBe(3);
  expect(outcome).toEqual({ confirmed: true, code: 2, stdout: "head\n[retained tail]\ntail", stderr: "err" });
});

it("selects this run's terminal receipt from a status list", async () => {
  const outcome = await confirmDesktopCommandResult({
    ...base,
    now: () => 2_000,
    sleep: async () => { throw new Error("a saved result must not wait"); },
    read: async () => [
      { runId: "other", state: "completed", exitCode: 0, stdout: "nope", stderr: "" },
      { runId: "run-1", state: "interrupted", exitCode: 9, stdout: "saved", stderr: "" },
    ],
  });
  expect(outcome).toEqual({ confirmed: true, code: 9, stdout: "saved", stderr: "" });
});

it("stops waiting and records the run when the receipt never becomes terminal", async () => {
  let clock = 0;
  const logs: Array<Record<string, string | number | undefined>> = [];
  const outcome = await confirmDesktopCommandResult({
    ...base,
    startedAt: 0,
    timeoutMs: 400,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    log: (event, fields) => logs.push({ event, ...fields }),
    read: async () => { throw new Error("Local computer disconnected. Check the result before retrying."); },
  });
  expect(outcome).toEqual({ confirmed: false, error: UNCONFIRMED_COMMAND_RESULT });
  expect(logs).toEqual([{
    event: "desktop.command.result_unconfirmed",
    "run.id": "run-1",
    "tool.name": "shell",
    "desktop.command.id": "run-1:effect",
    "desktop.elapsed_ms": clock,
  }]);
  expect(clock).toBeGreaterThanOrEqual(400);
});

it("does not wait out the timeout after the run is aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stopped"));
  let reads = 0;
  await expect(confirmDesktopCommandResult({
    ...base,
    signal: controller.signal,
    timeoutMs: 10_000,
    sleep: async () => { throw new Error("aborted confirmation must not sleep"); },
    read: async () => { reads += 1; return null; },
  })).rejects.toThrow("stopped");
  expect(reads).toBe(0);
});

it("recognises a lost desktop delivery and ignores unrelated failures", () => {
  expect(isUnconfirmedCommandDelivery(new Error("Desktop execution interrupted; check existing results before retrying"))).toBe(true);
  expect(isUnconfirmedCommandDelivery(new Error("Desktop execution disconnected; check existing results before retrying"))).toBe(true);
  expect(isUnconfirmedCommandDelivery(new Error("Local computer disconnected. Check the result before retrying."))).toBe(true);
  expect(isUnconfirmedCommandDelivery(new Error("Shell stream ended without a confirmed exit (code missing)"))).toBe(true);
  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  expect(isUnconfirmedCommandDelivery(aborted)).toBe(false);
  expect(isUnconfirmedCommandDelivery(new Error("The PC is updating; pending work will resume after reconnecting."))).toBe(false);
  expect(isUnconfirmedCommandDelivery("Desktop execution interrupted")).toBe(false);
});
