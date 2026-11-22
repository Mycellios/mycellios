import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stopThreadRuns: vi.fn(),
  stopWorkForThread: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  markDeleted: vi.fn(),
}));
vi.mock("./thread-target.js", () => ({ stopThreadRuns: mocks.stopThreadRuns }));
vi.mock("./work-controls.js", () => ({ stopWorkForThread: mocks.stopWorkForThread }));
vi.mock("@mycellios/db", async (original) => ({
  ...(await original<object>()),
  archiveSideThreadInTransaction: mocks.archive,
  restoreSideThreadInTransaction: mocks.restore,
  markSideThreadDeletedInTransaction: mocks.markDeleted,
}));

import { ThreadLifecycleError } from "@mycellios/db";
import { archiveSideThread, deleteSideThread, restoreSideThread } from "./side-threads.js";

const actor = { userId: "owner", spaceId: "space" } as never;
const target = { kind: "bot", botId: "mico", threadId: "side", bot: { id: "mico", thread: { id: "main" } } } as never;
const mainChat = { kind: "bot", botId: "mico", threadId: "main", bot: { id: "mico", thread: { id: "main" } } } as never;
const tx = { marker: "tx" };
function deps() {
  return {
    prisma: { $transaction: vi.fn(async (operation: (client: typeof tx) => unknown) => operation(tx)) },
    sandbox: {},
    events: {},
    jobs: { enqueue: vi.fn().mockResolvedValue(undefined) },
  } as never as {
    prisma: { $transaction: ReturnType<typeof vi.fn> };
    jobs: { enqueue: ReturnType<typeof vi.fn> };
  };
}
const busy = () => new ThreadLifecycleError("busy", "This conversation is still working. Stop it, then try again.");

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.stopThreadRuns.mockResolvedValue(undefined);
  mocks.stopWorkForThread.mockResolvedValue(undefined);
});

describe("archiveSideThread", () => {
  it("cancels queued messages and runs and stops delegated work before archiving under the lock", async () => {
    const d = deps();
    const archivedAt = new Date("2026-11-22T10:00:00Z");
    mocks.archive.mockResolvedValue({ archivedAt });
    await expect(archiveSideThread(d as never, actor, target)).resolves.toEqual({ archivedAt });
    expect(mocks.stopThreadRuns).toHaveBeenCalledWith(d, actor, target);
    expect(mocks.stopWorkForThread).toHaveBeenCalledWith(d, actor, "side");
    expect(mocks.archive).toHaveBeenCalledWith(tx, actor, { botId: "mico", threadId: "side" });
    expect(mocks.stopThreadRuns.mock.invocationCallOrder[0]).toBeLessThan(mocks.archive.mock.invocationCallOrder[0]!);
  });

  it("stops work that started again and retries until the conversation settles", async () => {
    const d = deps();
    let clock = 0;
    const sleep = vi.fn(async (ms: number) => { clock += ms; });
    mocks.archive.mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy()).mockResolvedValue({ archivedAt: new Date() });
    await archiveSideThread(d as never, actor, target, { now: () => clock, sleep, pollMs: 500 });
    expect(mocks.stopThreadRuns).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after about 15 seconds with an explanation and leaves the conversation open", async () => {
    const d = deps();
    let clock = 0;
    mocks.archive.mockRejectedValue(busy());
    await expect(
      archiveSideThread(d as never, actor, target, { now: () => clock, sleep: async (ms) => { clock += ms; } }),
    ).rejects.toMatchObject({ code: "busy", message: expect.stringContaining("still working") });
    expect(clock).toBeGreaterThanOrEqual(15_000);
    expect(clock).toBeLessThan(16_000);
  });

  it("never retries other refusals", async () => {
    const d = deps();
    mocks.archive.mockRejectedValue(new ThreadLifecycleError("deleting", "being deleted"));
    await expect(archiveSideThread(d as never, actor, target, { sleep: vi.fn() })).rejects.toMatchObject({ code: "deleting" });
    expect(mocks.archive).toHaveBeenCalledOnce();
  });

  it("refuses the main chat before stopping anything", async () => {
    const d = deps();
    await expect(archiveSideThread(d as never, actor, mainChat)).rejects.toMatchObject({ code: "main_chat" });
    expect(mocks.stopThreadRuns).not.toHaveBeenCalled();
    expect(d.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("deleteSideThread", () => {
  it("schedules the removal after the undo window and a grace period", async () => {
    const d = deps();
    const deleteAfter = new Date("2026-11-22T10:00:06Z");
    mocks.markDeleted.mockResolvedValue({ deleteAfter });
    await expect(deleteSideThread(d as never, actor, target)).resolves.toEqual({ deleteAfter });
    expect(mocks.markDeleted).toHaveBeenCalledWith(tx, actor, { botId: "mico", threadId: "side" });
    expect(d.jobs.enqueue).toHaveBeenCalledWith({
      name: "thread.delete",
      payload: { threadId: "side" },
      availableAt: new Date("2026-11-22T10:00:11Z"),
      replaceKey: "thread.delete:side",
    });
  });

  it("keeps the pending delete when the job cannot be queued; the reconciler finishes it", async () => {
    const d = deps();
    mocks.markDeleted.mockResolvedValue({ deleteAfter: new Date() });
    d.jobs.enqueue.mockRejectedValue(new Error("queue down"));
    await expect(deleteSideThread(d as never, actor, target)).resolves.toBeDefined();
  });

  it("refuses the main chat and a conversation that still works", async () => {
    const d = deps();
    await expect(deleteSideThread(d as never, actor, mainChat)).rejects.toMatchObject({ code: "main_chat" });
    mocks.markDeleted.mockRejectedValue(new ThreadLifecycleError("busy", "Stop it before you delete it."));
    await expect(deleteSideThread(d as never, actor, target)).rejects.toMatchObject({ code: "busy" });
    expect(d.jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe("restoreSideThread", () => {
  it("restores in one transaction and never the main chat", async () => {
    const d = deps();
    mocks.restore.mockResolvedValue({ restored: "delete" });
    await expect(restoreSideThread(d as never, actor, target)).resolves.toEqual({ restored: "delete" });
    expect(mocks.restore).toHaveBeenCalledWith(tx, actor, { botId: "mico", threadId: "side" });
    await expect(restoreSideThread(d as never, actor, mainChat)).rejects.toMatchObject({ code: "main_chat" });
  });
});
