import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { queuedBehindConversation } from "./thread-target.js";

const target = { botId: "bot-1", threadId: "side-1" };

function blocker(
  threadId: string,
  thread: Record<string, unknown>,
  routine: { name: string } | null = null,
  own: { memberUserId: string | null } | null = { memberUserId: null },
) {
  const findFirst = vi.fn(async (_query: unknown) => ({
    threadId,
    thread: { title: null, memberUserId: null, archivedAt: null, deleteAfter: null, ...thread },
    routine,
    bot: { thread: { id: "main-1" } },
  }));
  const prisma = {
    run: { findFirst },
    thread: { findUnique: vi.fn(async () => own) },
  } as unknown as Pick<PrismaClient, "run" | "thread">;
  return { prisma, findFirst };
}

describe("queuedBehindConversation", () => {
  it("names the same Mico's live turn in another conversation", async () => {
    const { prisma, findFirst } = blocker("side-2", { title: "Daily scout" });
    await expect(queuedBehindConversation(prisma, target, "run-q")).resolves.toEqual({
      threadId: "side-2",
      title: "Daily scout",
      main: false,
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          botId: "bot-1",
          id: { not: "run-q" },
          threadId: { not: "side-1" },
          status: { in: ["leased", "running"] },
        }),
      }),
    );
  });

  it("falls back to the routine name and never titles the main chat", async () => {
    await expect(
      queuedBehindConversation(blocker("routine-t", {}, { name: "Weekly report" }).prisma, target, "run-q"),
    ).resolves.toMatchObject({ title: "Weekly report", main: false });
    await expect(
      queuedBehindConversation(blocker("main-1", { title: "Main" }).prisma, target, "run-q"),
    ).resolves.toEqual({ threadId: "main-1", title: null, main: true });
  });

  it("hides hidden titles and never reveals or explains to a Space member", async () => {
    await expect(
      queuedBehindConversation(
        blocker("side-3", { title: "Old", archivedAt: new Date() }).prisma,
        target,
        "run-q",
      ),
    ).resolves.toMatchObject({ title: null });
    await expect(
      queuedBehindConversation(
        blocker("side-4", { title: "Theirs", memberUserId: "member" }).prisma,
        target,
        "run-q",
      ),
    ).resolves.toBeNull();
    const memberView = blocker("side-2", { title: "Owner chat" }, null, { memberUserId: "member" });
    await expect(queuedBehindConversation(memberView.prisma, target, "run-q")).resolves.toBeNull();
    expect(memberView.findFirst).not.toHaveBeenCalled();
  });

  it("returns nothing when no other turn holds the Mico", async () => {
    const prisma = {
      run: { findFirst: vi.fn(async () => null) },
      thread: { findUnique: vi.fn(async () => ({ memberUserId: null })) },
    } as unknown as Pick<PrismaClient, "run" | "thread">;
    await expect(queuedBehindConversation(prisma, target, "run-q")).resolves.toBeNull();
  });
});
