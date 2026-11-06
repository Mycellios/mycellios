// @vitest-environment jsdom
import type { Workflow, WorkflowExecution } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
import { useWorkflows } from "./use-workflows";

const scope = "fixture-owner/space",
  key = `mycellios:workflows:${scope}`;
const saved: Workflow = {
  id: "flow",
  version: 1,
  name: "My workflow",
  active: false,
  nextRunAt: null,
  updatedAt: new Date().toISOString(),
  graph: {
    nodes: [
      { id: "start", kind: "trigger", trigger: "manual", x: 0, y: 0, title: "Start", text: "" },
      {
        id: "agent",
        kind: "agent",
        botId: "owned",
        x: 300,
        y: 0,
        title: "Mico",
        text: "Read input",
      },
    ],
    edges: [{ id: "edge", from: "start", to: "agent" }],
  },
};
const receipt: WorkflowExecution = {
  id: "execution",
  workflowId: saved.id,
  version: 1,
  status: "completed",
  steps: {},
  error: null,
  createdAt: saved.updatedAt,
  updatedAt: saved.updatedAt,
};
const api = {
  available: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  runs: vi.fn(),
  execute: vi.fn(),
  stop: vi.fn(),
};
const client = { workflows: api } as unknown as RpcClient;
let state: ReturnType<typeof useWorkflows>, root: ReturnType<typeof createRoot>;
function Probe() {
  state = useWorkflows(client, scope);
  return null;
}
async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem(key, JSON.stringify([saved]));
  api.available.mockResolvedValue({ enabled: true });
  api.list.mockResolvedValue([saved]);
  api.runs.mockResolvedValue([]);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("retains an uncertain nonce across remount and only retries when requested", async () => {
  api.execute.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => state.run());
  const request = api.execute.mock.calls[0]![0];
  expect(api.execute).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(`${key}:pending:flow`)).toContain(request.clientNonce);
  await act(async () => root.unmount());
  await mount();
  expect(api.execute).toHaveBeenCalledTimes(1);
  api.execute.mockResolvedValueOnce(receipt);
  await act(async () => state.run());
  expect(api.execute.mock.calls[1]![0]).toEqual(request);
  expect(localStorage.getItem(`${key}:pending:flow`)).toBeNull();
});
it("allows a corrected graph to save and run after a definitive validation refusal", async () => {
  api.execute.mockRejectedValueOnce(
    Object.assign(new Error("Invalid graph"), { code: "BAD_REQUEST" }),
  );
  await act(async () => state.run());
  const old = api.execute.mock.calls[0]![0];
  expect(localStorage.getItem(`${key}:pending:flow`)).toBeNull();
  await act(async () => state.update({ name: "Corrected graph" }));
  api.save.mockResolvedValue({ ...saved, version: 2, name: "Corrected graph" });
  api.execute.mockResolvedValue(receipt);
  await act(async () => state.run());
  expect(api.execute.mock.calls[1]![0].expectedVersion).toBe(2);
  expect(api.execute.mock.calls[1]![0].clientNonce).not.toBe(old.clientNonce);
});
it("preserves a dirty draft on version conflict and does not automatically overwrite it", async () => {
  await act(async () => state.update({ name: "Keep this local work" }));
  api.save.mockRejectedValue(Object.assign(new Error("Version changed"), { code: "CONFLICT" }));
  await act(async () => state.save());
  expect(state.doc.name).toBe("Keep this local work");
  expect(state.doc.dirty).toBe(true);
  expect(state.doc.version).toBe(1);
  expect(api.save).toHaveBeenCalledTimes(1);
});
it("serializes simultaneous requests without an extra execution", async () => {
  let finish!: (value: WorkflowExecution) => void;
  api.execute.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = state.run();
    void state.run();
  });
  expect(api.execute).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(receipt);
    await pending;
  });
});

it("keeps edits made after an uncertain create instead of replacing them with its old receipt", async () => {
  await act(async () => root.unmount());
  localStorage.setItem(
    key,
    JSON.stringify([{ ...saved, version: 0, name: "New local edits", dirty: true }]),
  );
  api.list.mockResolvedValue([]);
  api.create.mockResolvedValue(saved);
  await mount();
  await act(async () => state.save());
  expect(state.doc.name).toBe("New local edits");
  expect(state.doc.version).toBe(1);
  expect(state.doc.dirty).toBe(true);
  expect(api.save).not.toHaveBeenCalled();
});
