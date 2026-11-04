import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { sendThreadMessage, type ThreadTarget } from "../thread-target.js";

describe("voice idle-only thread admission", () => {
  it.each(["queued", "leased", "running", "waiting_input", "waiting_takeover"])(
    "rolls back the send rather than steering or answering a %s run",
    async (status) => {
      const pending: object[] = [];
      const updateRun = vi.fn();
      const updateTask = vi.fn();
      const enqueue = vi.fn();
      const notify = vi.fn();
      const tx = {
        $queryRaw: vi.fn(async () => [{ id: "thread" }]),
        thread: { update: vi.fn(async () => ({ nextMessageSeq: 2 })) },
        message: {
          create: vi.fn(async ({ data }: { data: object }) => {
            const message = {
              id: "candidate",
              threadId: "thread",
              seq: 1,
              createdAt: new Date(),
              ...data,
            };
            pending.push(message);
            return message;
          }),
          update: vi.fn(),
          findMany: vi.fn(),
        },
        run: {
          findMany: vi.fn(async () => [{ id: "busy", taskId: "task", status, trigger: "user" }]),
          updateMany: updateRun,
        },
        task: { updateMany: updateTask, create: vi.fn() },
        event: { create: vi.fn() },
        steeringMessage: { create: vi.fn() },
      };
      const prisma = {
        message: { findUnique: vi.fn(async () => null) },
        $transaction: vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => {
          try {
            return await work(tx);
          } catch (error) {
            pending.length = 0;
            throw error;
          }
        }),
      } as unknown as PrismaClient;
      const target = {
        kind: "bot",
        botId: "mico",
        threadId: "thread",
        bot: { computer: null },
      } as ThreadTarget;
      await expect(
        sendThreadMessage(
          { prisma, jobs: { enqueue } as never, events: { notify } as never },
          { userId: "user", spaceId: "space" } as Actor,
          target,
          { text: "Yes", clientNonce: "call:trial:turn", queueOnlyWhenIdle: true },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(pending).toEqual([]);
      expect(updateRun).not.toHaveBeenCalled();
      expect(updateTask).not.toHaveBeenCalled();
      expect(tx.steeringMessage.create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    },
  );
  it("refuses an idle-only group send before starting a transaction", async () => {
    const transaction = vi.fn();
    await expect(
      sendThreadMessage(
        { prisma: { $transaction: transaction } as never, jobs: {} as never, events: {} as never },
        { userId: "user", spaceId: "space" } as Actor,
        { kind: "group", groupId: "group", threadId: "thread" } as ThreadTarget,
        { text: "Hello", queueOnlyWhenIdle: true },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
