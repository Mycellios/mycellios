import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import type { ThreadTarget } from "./thread-target.js";
import { queuedBehindConversation } from "./thread-target.js";

const target = {
  kind: "bot",
  botId: "bot-1",
  threadId: "side-1",
  bot: { thread: { id: "main-1" } },
} as unknown as Extract<ThreadTarget, { kind: "bot" }>;

function blocker(
  threadId: string,
  thread: Record<string, unknown>,
  routine: { name: string } | null = null,
) {
  const findFirst = vi.fn(async (_query: unknown) => ({
    threadId,
    thread: { title: null, memberUserId: null, archivedAt: null, deleteAfter: null, ...thread },
    routine,
  }));
  return { prisma: { run: { findFirst } } as unknown as Pick<PrismaClient, "run">, findFirst };
}

describe("queuedBehindConversation", () => {
  it("names the same Mico's live turn in another conversation", async () => {
    const { prisma, findFirst } = blocker("side-2", { title: "Forocoches" });
    await expect(queuedBehindConversation(prisma, target, "run-q")).resolves.toEqual({
      threadId: "side-2",
      title: "Forocoches",
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
      queuedBehindConversation(blocker("routine-t", {}, { name: "Daily scout" }).prisma, target, "run-q"),
    ).resolves.toMatchObject({ title: "Daily scout", main: false });
    await expect(
      queuedBehindConversation(blocker("main-1", { title: "Main" }).prisma, target, "run-q"),
    ).resolves.toEqual({ threadId: "main-1", title: null, main: true });
  });

  it("hides hidden titles and never reveals a Space member's conversation", async () => {
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
  });

  it("returns nothing when no other turn holds the Mico", async () => {
    const prisma = { run: { findFirst: vi.fn(async () => null) } } as unknown as Pick<PrismaClient, "run">;
    await expect(queuedBehindConversation(prisma, target, "run-q")).resolves.toBeNull();
  });
});
