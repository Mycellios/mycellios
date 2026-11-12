import { expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { resetThreadContext, ThreadContextBusyError } from "./thread-context-reset.js";
function fixture() {
  const tx = { thread: { update: vi.fn(async (input) => input.select?.nextMessageSeq ? { nextMessageSeq: 11 } : input.select?.nextEventSeq ? { nextEventSeq: 4 } : { id: "thread" }) },
    message: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "divider", seq: 10 }) },
    run: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    steeringMessage: { findFirst: vi.fn().mockResolvedValue(null) },
    event: { create: vi.fn().mockResolvedValue({ seq: 3 }) } };
  const prisma = { $transaction: vi.fn(callback => callback(tx)) } as unknown as PrismaClient;
  return { tx, prisma };
}
const actor = { userId: "user", spaceId: "space" }, input = { threadId: "thread", botId: "bot", clientNonce: "request" };
it("adds a durable divider and advances context without deleting messages or touching Mico settings", async () => {
 const { prisma, tx } = fixture(); expect(await resetThreadContext(prisma, actor, input)).toEqual({ eventSeq: 3 });
 expect(tx.thread.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "thread", userId: "user", spaceId: "space", OR: [{ botId: "bot" }, { taskBotId: "bot" }] } }));
 expect(tx.message.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: "system", blocks: [{ kind: "context_reset" }], clientNonce: "context-reset:request" }) }));
 expect(tx.thread.update).toHaveBeenCalledWith({ where: { id: "thread" }, data: { contextStartSeq: 11, historyCompactedUpToSeq: 10, historyCompactionSummary: null, historyCompactionGeneration: { increment: 1 }, agentContextReset: Prisma.DbNull }, select: { id: true } });
 expect(tx.event.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "thread.message.created" }) }));
 expect(tx.run.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["completed", "failed", "cancelled"] } }) }));
});
it.each(["run", "queue"])("refuses a reset while %s is pending without creating a divider", async (kind) => {
 const { prisma, tx } = fixture(); (kind === "run" ? tx.run.findFirst : tx.steeringMessage.findFirst).mockResolvedValue({ id: "pending" });
 await expect(resetThreadContext(prisma, actor, input)).rejects.toBeInstanceOf(ThreadContextBusyError);
 expect(tx.message.create).not.toHaveBeenCalled(); expect(tx.run.updateMany).not.toHaveBeenCalled();
});
it("does not reset a different account or Space", async () => {
 const { prisma, tx } = fixture(); tx.thread.update.mockRejectedValueOnce(new Error("not owned"));
 await expect(resetThreadContext(prisma, actor, input)).rejects.toThrow("not owned"); expect(tx.message.create).not.toHaveBeenCalled();
});
it("deduplicates a retry before checking new work or changing context", async () => {
 const { prisma, tx } = fixture(); tx.message.findUnique.mockResolvedValue({ id: "already-reset" });
 expect(await resetThreadContext(prisma, actor, input)).toEqual({ eventSeq: null });
 expect(tx.message.create).not.toHaveBeenCalled(); expect(tx.run.findFirst).not.toHaveBeenCalled(); expect(tx.thread.update).toHaveBeenCalledOnce();
});
it.each(["revoked", "failed"])("cancels an agent handoff when its permission is %s instead of reviving it later", async kind => {
 const { prisma, tx } = fixture();
 const request = { runId: "source", notes: "Saved constraints and results for the next conversation." };
 Object.assign(tx.thread, { findUniqueOrThrow: vi.fn().mockResolvedValue({ agentContextReset: request }) });
 Object.assign(tx, {
  user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue({ micoDefaults: { agentNewChat: kind !== "revoked" } }) },
  bot: { findFirst: vi.fn().mockResolvedValue({ micoPreferences: {} }) },
 });
 tx.run.findFirst.mockResolvedValue({ id: "source", status: kind === "failed" ? "failed" : "completed" });
 expect(await resetThreadContext(prisma, actor, { ...input, agentRequest: request })).toEqual({ eventSeq: null });
 expect(tx.message.create).not.toHaveBeenCalled();
 expect(tx.thread.update).toHaveBeenCalledWith({ where: { id: "thread" }, data: { agentContextReset: Prisma.DbNull } });
});
