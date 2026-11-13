// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startEventAgentPresence } from "./event-agent-presence";
afterEach(() => { vi.useRealTimers(); });
it("keeps a visible guest present without overlapping reads or reenrolling after a temporary failure", async () => {
  vi.useFakeTimers();
  let finish!: (value: { open: boolean }) => void;
  const read = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ open: true });
  const closed = vi.fn(), stop = startEventAgentPresence(read, closed);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(read).toHaveBeenCalledTimes(2);
  finish({ open: true }); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(read).toHaveBeenCalledTimes(3); expect(closed).not.toHaveBeenCalled();
  stop(); await vi.advanceTimersByTimeAsync(30_000); expect(read).toHaveBeenCalledTimes(3);
});
it("does not end a different profile after an old presence request finishes", async () => {
  vi.useFakeTimers();
  let finish!: (value: { open: boolean }) => void;
  const closed = vi.fn();
  const stop = startEventAgentPresence(() => new Promise(resolve => { finish = resolve; }), closed);
  stop(); finish({ open: false }); await Promise.resolve(); expect(closed).not.toHaveBeenCalled();
  const current = startEventAgentPresence(async () => ({ open: false }), closed);
  await Promise.resolve(); expect(closed).toHaveBeenCalledOnce(); current();
});
