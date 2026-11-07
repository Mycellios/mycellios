import { describe, expect, it, vi } from "vitest";
import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import type { ThreadTarget } from "./thread-target.js";
import { retryThreadRun } from "./retry-thread-run.js";

const actor = { userId: "owner", spaceId: "space" } as Actor;
const target = { kind: "bot", botId: "bot", threadId: "thread" } as ThreadTarget;
function fixture(overrides = {}) {
  const run = { id: "run", status: "failed", botId: "bot", taskId: "task",
    sourceMessageId: "original-with-images", firstResponseAt: null, _count: { effects: 0 }, ...overrides };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    run: { findFirst: vi.fn().mockResolvedValueOnce(run).mockResolvedValue(null), update: vi.fn() },
    task: { update: vi.fn() },
    message: { count: vi.fn().mockResolvedValue(0) },
  };
  const prisma = { $transaction: vi.fn(async (fn) => fn(tx)) } as unknown as PrismaClient;
  return { tx, prisma };
}
describe("retry original failed turn", () => {
  it("scopes ownership and requeues the same run without copying messages, attachments or checkpoints", async () => {
    const { prisma, tx } = fixture();
    await retryThreadRun(prisma, actor, target, "run");
    expect(tx.run.findFirst.mock.calls[0][0].where).toEqual({
      id: "run", threadId: "thread", botId: "bot", userId: "owner", spaceId: "space",
    });
    expect(tx.run.update).toHaveBeenCalledWith({ where: { id: "run" }, data: {
      status: "queued", error: null, startedAt: null, completedAt: null, wakeAt: null,
      leaseOwner: null, leaseExpiresAt: null, leaseFence: { increment: 1 },
    } });
    expect(tx.task.update).toHaveBeenCalledWith({ where: { id: "task" }, data: { status: "queued" } });
  });
  it.each(["queued", "running"])("is idempotent when already %s", async (status) => {
    const { prisma, tx } = fixture({ status });
    await retryThreadRun(prisma, actor, target, "run");
    expect(tx.run.update).not.toHaveBeenCalled();
  });
  it.each([
    { status: "completed" }, { status: "cancelled" }, { sourceMessageId: null },
    { _count: { effects: 1 } }, { firstResponseAt: new Date() },
    { error: "Desktop execution interrupted; check existing results before retrying" },
  ])("refuses unsafe or terminal replay: %j", async (state) => {
    const { prisma, tx } = fixture(state);
    await expect(retryThreadRun(prisma, actor, target, "run")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.run.update).not.toHaveBeenCalled();
  });
  it("does not interrupt a different active task", async () => {
    const { prisma, tx } = fixture();
    tx.run.findFirst.mockResolvedValueOnce({ id: "busy" });
    await expect(retryThreadRun(prisma, actor, target, "run")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.run.update).not.toHaveBeenCalled();
  });
  it("does not replay a recorded tool card even when first-response tracking is absent", async () => {
    const { prisma, tx } = fixture();
    tx.message.count.mockResolvedValue(1);
    await expect(retryThreadRun(prisma, actor, target, "run")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(tx.run.update).not.toHaveBeenCalled();
  });
  it("rejects an inaccessible run", async () => {
    const { prisma, tx } = fixture();
    tx.run.findFirst.mockReset().mockResolvedValue(null);
    await expect(retryThreadRun(prisma, actor, target, "run")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(tx.run.update).not.toHaveBeenCalled();
  });
});
