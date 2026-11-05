import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { isOwnedWorkflowThread } from "./workflow-thread.js";

describe("isOwnedWorkflowThread", () => {
  const thread = { id: "thread", taskBotId: "bot", taskKey: "workflow:execution:mico", projectKey: "workflow:flow" };
  const actor = { userId: "owner", spaceId: "space", id: "run", botId: "bot", threadId: "thread", status: "queued", trigger: "workflow" };
  function fixture(execution: unknown = { id: "execution" }, run: unknown = { id: "run" }) {
    const db = { workflowExecution: { findFirst: vi.fn().mockResolvedValue(execution) }, run: { findFirst: vi.fn().mockResolvedValue(run) } };
    return { db, prisma: db as unknown as PrismaClient };
  }
  it("projects a full Run onto owner and Space without overriding execution identity", async () => {
    const { db, prisma } = fixture();
    expect(await isOwnedWorkflowThread(prisma, actor, thread)).toBe(true);
    expect(db.workflowExecution.findFirst).toHaveBeenCalledWith({ where: { id: "execution", workflowId: "flow", userId: "owner", spaceId: "space" }, select: { id: true } });
    expect(db.run.findFirst).toHaveBeenCalledWith({ where: { userId: "owner", spaceId: "space", threadId: "thread", botId: "bot", trigger: "workflow", clientNonce: "workflow:execution:mico" }, select: { id: true } });
  });
  it("rejects an execution outside the supplied owner scope", async () => {
    const { db, prisma } = fixture(null);
    expect(await isOwnedWorkflowThread(prisma, actor, thread)).toBe(false);
    expect(db.run.findFirst).not.toHaveBeenCalled();
  });
  it("requires the workflow run bound to this private thread", async () => {
    const { prisma } = fixture({ id: "execution" }, null);
    expect(await isOwnedWorkflowThread(prisma, actor, thread)).toBe(false);
  });
  it("does not query for an ordinary task", async () => {
    const { db, prisma } = fixture();
    expect(await isOwnedWorkflowThread(prisma, actor, { ...thread, taskKey: "ordinary" })).toBe(false);
    expect(db.workflowExecution.findFirst).not.toHaveBeenCalled();
  });
});
