// @vitest-environment jsdom
import type { InboxTask } from "@rakazo/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
import { useTaskInbox } from "./use-task-inbox";

const api = { available: vi.fn(), list: vi.fn(), start: vi.fn() },
  client = { taskInbox: api } as unknown as RpcClient;
const item: InboxTask = {
  id: "item",
  botId: "a",
  threadId: "private",
  title: "Do this",
  runId: "run",
  status: "queued",
  error: null,
  progress: null,
  unread: false,
  archivedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
let root: ReturnType<typeof createRoot>, state: ReturnType<typeof useTaskInbox>;
function Probe() {
  state = useTaskInbox(client, "owner/space", "a");
  return null;
}
async function mount() {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.resetAllMocks();
  localStorage.clear();
  api.available.mockResolvedValue({ enabled: true });
  api.list.mockResolvedValue([]);
  api.start.mockResolvedValue(item);
  await mount();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("keeps the six-second undo window without sending and restores text and attachments", async () => {
  await act(async () => {
    state.setDraft("Do this");
  });
  await act(async () => state.start(undefined, ["file"]));
  await act(async () => vi.advanceTimersByTimeAsync(5999));
  expect(api.start).not.toHaveBeenCalled();
  let restored: ReturnType<typeof state.undo>;
  await act(async () => {
    restored = state.undo();
  });
  expect(restored!.artifactIds).toEqual(["file"]);
  expect(state.draft).toBe("Do this");
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(api.start).not.toHaveBeenCalled();
});
it("starts once after the undo deadline and uses the selected Mico", async () => {
  await act(async () => state.start("Do this"));
  await act(async () => state.reassignPending("b"));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(api.start).toHaveBeenCalledTimes(1);
  expect(api.start.mock.calls[0]![0]).toMatchObject({
    botId: "b",
    text: "Do this",
    clientNonce: expect.any(String),
  });
  expect(state.receipt?.id).toBe(item.id);
});
it("retains an ambiguous nonce across reopening and does not automatically retry", async () => {
  api.start.mockRejectedValueOnce(new Error("Connection lost"));
  await act(async () => state.start("Do this"));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  const first = api.start.mock.calls[0]![0];
  expect(state.pending?.phase).toBe("uncertain");
  await act(async () => root.unmount());
  await mount();
  await act(async () => vi.advanceTimersByTimeAsync(20000));
  expect(api.start).toHaveBeenCalledTimes(1);
  await act(async () => state.retry());
  expect(api.start.mock.calls[1]![0]).toEqual(first);
  expect(state.pending).toBeNull();
});
it("restores a definitively refused request as a draft instead of reporting a task", async () => {
  api.start.mockRejectedValueOnce(
    Object.assign(new Error("Model required"), { code: "BAD_REQUEST" }),
  );
  await act(async () => state.start("Do this"));
  await act(async () => vi.advanceTimersByTimeAsync(6000));
  expect(state.pending).toBeNull();
  expect(state.draft).toBe("Do this");
  expect(state.receipt).toBeNull();
});
it("commits an authorized pending start when leaving the page", async () => {
  await act(async () => state.start("Do this"));
  await act(async () => root.unmount());
  expect(api.start).toHaveBeenCalledTimes(1);
  await mount();
});
it("recovers a refused pending send after leaving the page", async () => {
  api.start.mockRejectedValueOnce(
    Object.assign(new Error("Model required"), { code: "BAD_REQUEST" }),
  );
  await act(async () => state.start("Keep this task"));
  await act(async () => root.unmount());
  await mount();
  expect(state.pending).toBeNull();
  expect(state.draft).toBe("Keep this task");
  expect(api.start).toHaveBeenCalledTimes(1);
});
