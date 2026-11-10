import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
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
