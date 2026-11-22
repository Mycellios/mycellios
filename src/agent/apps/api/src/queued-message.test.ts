import type { Actor } from "@mycellios/contracts";
import type { PrismaClient } from "@mycellios/db";
import { expect, it, vi } from "vitest";
import { MessageQueueConflictError } from "@mycellios/core";
import { moveQueuedMessageToConversation, queueAction } from "./message-queue.js";
import { sendThreadMessage, type ThreadTarget } from "./thread-target.js";
it.each(["queue", "steer"] as const)("persists the deliberate %s delivery without starting a duplicate run", async delivery => {
  const live = { id: "live", taskId: "task", trigger: "user", status: "running", startedAt: new Date() };
  const tx = {
    secret: { deleteMany: vi.fn() },
    thread: { update: vi.fn().mockResolvedValue({ nextMessageSeq: 2, nextEventSeq: 2 }) },
    message: { create: vi.fn().mockResolvedValue({ id: "message", seq: 1, role: "user", blocks: [{ kind: "text", text: "Next" }], createdAt: new Date() }), update: vi.fn() },
    run: { findMany: vi.fn().mockResolvedValue([live]), findUnique: vi.fn().mockResolvedValue(live), create: vi.fn() },
    task: { create: vi.fn() },
    event: { create: vi.fn().mockResolvedValue({ seq: 2 }) },
    steeringMessage: { create: vi.fn() },
  };
  const prisma = { message: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  const release = vi.fn().mockResolvedValue(undefined);
  await sendThreadMessage({ prisma, events: { notify: vi.fn().mockResolvedValue(undefined) } as never, jobs: { enqueue: vi.fn() } as never }, { spaceId: "space", userId: "user" } as Actor, { kind: "bot", botId: "bot", threadId: "thread" } as ThreadTarget, { text: "Next", clientNonce: "once", delivery }, release);
  expect(tx.run.create).not.toHaveBeenCalled();
  expect(tx.steeringMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining(delivery === "queue" ? { runId: null, originTrigger: "queued_user" } : { runId: "live" }) });
  expect(release).toHaveBeenCalledTimes(delivery === "queue" ? 0 : 1);
});

it("puts an explicitly queued message at the end of the queue, in the order it was sent", async () => {
  const live = { id: "live", taskId: "task", trigger: "user", status: "running", startedAt: new Date() };
  const tx = {
    secret: { deleteMany: vi.fn() },
    thread: { update: vi.fn().mockResolvedValue({ nextMessageSeq: 8, nextEventSeq: 2 }) },
    message: { create: vi.fn().mockResolvedValue({ id: "message", seq: 7, role: "user", blocks: [{ kind: "text", text: "Later" }], createdAt: new Date() }), update: vi.fn() },
    run: { findMany: vi.fn().mockResolvedValue([live]), findUnique: vi.fn().mockResolvedValue(live), create: vi.fn() },
    task: { create: vi.fn() },
    event: { create: vi.fn().mockResolvedValue({ seq: 2 }) },
    steeringMessage: { create: vi.fn() },
  };
  const prisma = { message: { findUnique: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  await sendThreadMessage({ prisma, events: { notify: vi.fn().mockResolvedValue(undefined) } as never, jobs: { enqueue: vi.fn() } as never }, { spaceId: "space", userId: "user" } as Actor, { kind: "bot", botId: "bot", threadId: "thread" } as ThreadTarget, { text: "Later", clientNonce: "later", delivery: "queue" });
  expect(tx.steeringMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ runId: null, originTrigger: "queued_user", position: 7 }) });
});

it("answers a lost queue race as a conflict with a stable code", async () => {
  await expect(queueAction(async () => { throw new MessageQueueConflictError("gone"); })).rejects.toMatchObject({
    code: "CONFLICT",
    message: "This message is no longer waiting: it already started or was removed.",
    data: { queueCode: "gone" },
  });
  await expect(queueAction(async () => "ok")).resolves.toBe("ok");
});

it("never moves a group message to a conversation of one Mico", async () => {
  const prisma = { $transaction: vi.fn() } as unknown as PrismaClient;
  await expect(moveQueuedMessageToConversation(
    { prisma, events: {} as never, jobs: {} as never, sandbox: {} as never },
    { spaceId: "space", userId: "user" } as Actor,
    { kind: "group", groupId: "group", threadId: "thread", groupName: "G", members: [], memberBotIds: ["a", "b"] },
    { messageId: "message" },
  )).rejects.toMatchObject({ code: "CONFLICT", data: { queueCode: "not_alone" } });
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
