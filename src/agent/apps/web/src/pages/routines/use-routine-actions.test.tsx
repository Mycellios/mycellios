// @vitest-environment jsdom
import type { Routine } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
import { useRoutineActions } from "./use-routine-actions";

const routine = { id: "routine-a", botId: "bot-a", active: true, prompt: "Keep this instruction" } as Routine;
const api = { testRun: vi.fn(), update: vi.fn() };
const client = { routines: api } as unknown as RpcClient;
let actions: ReturnType<typeof useRoutineActions>;
let root: ReturnType<typeof createRoot>;
const updated = vi.fn();
function Probe() { actions = useRoutineActions(client, "account/space/bot", updated); return null; }
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); sessionStorage.clear(); vi.clearAllMocks();
  root = createRoot(document.createElement("div")); await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("sends one owned execution with a nonce and waits for real completion before allowing another", async () => {
  let finish!: (result: { runId: string }) => void;
  api.testRun.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let first!: Promise<void>;
  await act(async () => { first = actions.run(routine); void actions.run(routine); });
  expect(api.testRun).toHaveBeenCalledTimes(1);
  expect(api.testRun.mock.calls[0]?.[0]).toMatchObject({ routineId: routine.id, clientNonce: expect.any(String) });
  await act(async () => { finish({ runId: "server-run" }); await first; });
  expect(actions.state(routine.id).runId).toBe("server-run");
  await act(async () => actions.run(routine));
  expect(api.testRun).toHaveBeenCalledTimes(1);
  await act(async () => actions.accepted(routine.id));
  api.testRun.mockResolvedValue({ runId: "next-run" });
  await act(async () => actions.run(routine));
  expect(api.testRun.mock.calls[1]?.[0].clientNonce).not.toBe(api.testRun.mock.calls[0]?.[0].clientNonce);
});
it("does not retry an uncertain command and reuses its nonce after reopening", async () => {
  api.testRun.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => actions.run(routine));
  expect(api.testRun).toHaveBeenCalledTimes(1);
  expect(actions.state(routine.id).error).toContain("Connection lost");
  const nonce = api.testRun.mock.calls[0]?.[0].clientNonce;
  await act(async () => root.unmount());
  root = createRoot(document.createElement("div")); await act(async () => root.render(<Probe />));
  api.testRun.mockResolvedValueOnce({ runId: "same-run" });
  await act(async () => actions.run(routine));
  expect(api.testRun.mock.calls[1]?.[0].clientNonce).toBe(nonce);
});
it("pauses through a minimal server patch and does not claim a failed update was saved", async () => {
  api.update.mockResolvedValueOnce({ ...routine, active: false });
  await act(async () => actions.toggle(routine));
  expect(api.update).toHaveBeenCalledWith({ routineId: routine.id, active: false });
  expect(updated).toHaveBeenCalledWith({ ...routine, active: false });
  api.update.mockRejectedValueOnce(new Error("Not allowed"));
  await act(async () => actions.toggle(routine));
  expect(updated).toHaveBeenCalledTimes(1);
  expect(actions.state(routine.id).error).toContain("Not allowed");
});
it("does not apply a late mutation to a workspace the user has left", async () => {
  let finish!: (result: Routine) => void;
  api.update.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  await act(async () => { pending = actions.toggle(routine); });
  await act(async () => root.unmount());
  await act(async () => { finish({ ...routine, active: false }); await pending; });
  expect(updated).not.toHaveBeenCalled();
  root = createRoot(document.createElement("div"));
});
