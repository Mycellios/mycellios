import type { ThreadSnapshot } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";
import { canRetryThreadRun, retryOriginalThreadRun } from "./retry-thread-run";

function snapshot(status = "failed", trigger = "user"): ThreadSnapshot {
  return {threadId: "thread", messages: [], run: {id: "original", botId: "bot", status, trigger}} as unknown as ThreadSnapshot;
}
function fixture(value = snapshot()) {
  const refresh = vi.fn(async () => value);
  const retry = vi.fn(async () => undefined);
  return {runId: "original", threadId: "thread", refresh, retry, isCurrent: vi.fn(() => true)};
}

it.each(["created", "routine", "bot_message", "project_prepare"])("never offers message retry for %s work", trigger => {
  expect(canRetryThreadRun(snapshot("failed", trigger))).toBe(false);
});
it("only offers retry for the original failed user turn without a saved reply", () => {
  const value = snapshot();
  expect(canRetryThreadRun(value, "original")).toBe(true);
  expect(canRetryThreadRun(value, "other")).toBe(false);
  value.messages.push({id: "saved-reply", role: "bot", runId: "original"} as ThreadSnapshot["messages"][number]);
  expect(canRetryThreadRun(value)).toBe(false);
  value.messages[0]!.id = "progress:original";
  expect(canRetryThreadRun(value)).toBe(true);
});
it("refreshes before retrying the same original turn, without creating a message or files", async () => {
  const f = fixture();
  await expect(retryOriginalThreadRun(f)).resolves.toBe("retried");
  expect(f.refresh).toHaveBeenCalledTimes(2);
  expect(f.retry).toHaveBeenCalledTimes(1);
  expect(f.refresh.mock.invocationCallOrder[0]).toBeLessThan(f.retry.mock.invocationCallOrder[0]!);
});
it("does not post a retry after an unconfirmed Desktop dispatch", async () => {
  const value = snapshot();
  value.run!.error = "Desktop execution interrupted; check existing results before retrying";
  const f = fixture(value);
  expect(canRetryThreadRun(value)).toBe(false);
  await expect(retryOriginalThreadRun(f)).resolves.toBe("changed");
  expect(f.retry).not.toHaveBeenCalled();
});
it.each(["queued", "running", "waiting_input", "completed", "cancelled"])("does not replay a stale failure that is now %s", async status => {
  const f = fixture(snapshot(status));
  await expect(retryOriginalThreadRun(f)).resolves.toBe("changed");
  expect(f.retry).not.toHaveBeenCalled();
});
it("does not target a different run or a replacement thread", async () => {
  for (const changed of [{threadId: "replacement"}, {run: {...snapshot().run!, id: "new-run"}}]) {
    const f = fixture({...snapshot(), ...changed});
    await expect(retryOriginalThreadRun(f)).resolves.toBe("changed");
    expect(f.retry).not.toHaveBeenCalled();
  }
});
it("does not retry or report into a chat left while the refresh was pending", async () => {
  const f = fixture(); f.isCurrent.mockReturnValue(false);
  await expect(retryOriginalThreadRun(f)).resolves.toBe("inactive");
  expect(f.retry).not.toHaveBeenCalled();
});
it.each([
  ["Only failed message requests can be retried.", "not_retryable"],
  ["This request already produced output or actions. Continue in the chat to avoid repeating them.", "unsafe"],
  ["Wait for the current task to finish before retrying.", "busy"],
])("reconciles an API refusal without repeating the POST: %s", async (message, outcome) => {
  const f = fixture(); f.retry.mockRejectedValue(Object.assign(new Error(message), {code: "CONFLICT"}));
  await expect(retryOriginalThreadRun(f)).resolves.toBe(outcome);
  expect(f.refresh).toHaveBeenCalledTimes(2);
  expect(f.retry).toHaveBeenCalledTimes(1);
});
it.each(["UNAUTHORIZED", "FORBIDDEN", "INTERNAL_SERVER_ERROR"])("preserves %s instead of hiding it as a state change", async code => {
  const f = fixture(); const error = Object.assign(new Error("Only failed message requests can be retried."), {code});
  f.retry.mockRejectedValue(error);
  await expect(retryOriginalThreadRun(f)).rejects.toBe(error);
  expect(f.refresh).toHaveBeenCalledTimes(1);
});
it("does not claim a refreshed chat if the reconciliation failed", async () => {
  const f = fixture();
  f.retry.mockRejectedValue(Object.assign(new Error("Only failed message requests can be retried."), {code: "CONFLICT"}));
  const failure = new Error("offline"); f.refresh.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(failure);
  await expect(retryOriginalThreadRun(f)).rejects.toBe(failure);
});

it('keeps an accepted retry successful if the follow-up read fails',async()=>{
 const f=fixture();f.refresh.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline'));
 await expect(retryOriginalThreadRun(f)).resolves.toBe('retried');
 expect(f.retry).toHaveBeenCalledTimes(1);
});
it('reconciles the legacy untyped refusal without another POST',async()=>{
 const f=fixture();f.retry.mockRejectedValue(new Error('Only failed message requests can be retried.'));
 await expect(retryOriginalThreadRun(f)).resolves.toBe('not_retryable');
 expect(f.retry).toHaveBeenCalledTimes(1);
});
