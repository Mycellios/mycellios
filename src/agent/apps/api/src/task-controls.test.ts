import type { Actor } from "@rakazo/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskControls } from "./task-controls.js";

const thread = vi.hoisted(() => ({
  resolve: vi.fn(async () => ({ threadId: "thread-1" })),
  stop: vi.fn(async () => undefined),
}));
vi.mock("./thread-target.js", () => ({
  resolveThreadTarget: thread.resolve,
  stopThreadRuns: thread.stop,
}));
const actor = { spaceId: "space-1", userId: "user-1" } as Actor;

function harness(options: { paused?: boolean; active?: number; lease?: number } = {}) {
  const task = {
    id: "task-1",
    threadId: "thread-1",
    botId: "bot-a",
    spaceId: actor.spaceId,
    userId: actor.userId,
    paused: options.paused ?? true,
    assignmentVersion: 3,
  };
  const original = {
    id: "run-original",
    taskId: task.id,
    threadId: task.threadId,
    task,
    thread: {
      groupId: "group-1",
      group: {
        archivedAt: null,
        members: [
          {
            botId: "bot-a",
            bot: { id: "bot-a", name: "A", userId: actor.userId, archivedAt: null },
          },
        ],
      },
    },
  };
  const tx = {
    $queryRaw: vi.fn(async () => []),
    task: {
      findFirst: vi.fn(async () => task),
      update: vi.fn(async () => task),
    },
    run: {
      findMany: vi.fn(async () =>
        Array.from({ length: options.active ?? 0 }, (_, i) => ({ id: `active-${i}` })),
      ),
      count: vi.fn(async () => options.lease ?? 0),
      create: vi.fn(async () => ({ id: "run-next" })),
    },
    chatGroup: { findFirst: vi.fn(async () => ({ id: "group-1" })) },
    chatGroupMember: { findFirst: vi.fn(async () => ({ botId: "bot-b" })) },
  };
  const prisma = {
    run: { findFirst: vi.fn(async () => original) },
    $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)),
  };
  const jobs = { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
  const controls = createTaskControls({ prisma, jobs, sandbox: {}, events: {} } as never);
  return { controls, tx, prisma, jobs };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("persistent task ownership controls", () => {
  it("reassigns only after pause, keeping the original task and thread", async () => {
    const h = harness();
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 3,
        action: "reassign",
        botId: "bot-b",
      }),
    ).resolves.toMatchObject({ taskId: "task-1", runId: "run-next", version: 4, paused: false });
    expect(h.tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: {
        botId: "bot-b",
        paused: false,
        status: "queued",
        assignmentVersion: { increment: 1 },
      },
    });
    expect(h.tx.run.create).toHaveBeenCalledWith({
      data: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        taskId: "task-1",
        threadId: "thread-1",
        botId: "bot-b",
        status: "queued",
        trigger: "user",
      },
    });
    expect(h.tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(h.jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects stale ownership versions without creating another run", async () => {
    const h = harness();
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 2,
        action: "resume",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.tx.run.create).not.toHaveBeenCalled();
    expect(h.tx.task.update).not.toHaveBeenCalled();
    expect(h.jobs.enqueue).not.toHaveBeenCalled();
  });

  it("does not reassign while the previous worker still holds a lease", async () => {
    const h = harness({ lease: 1 });
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 3,
        action: "reassign",
        botId: "bot-b",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.tx.run.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: "task-1",
          OR: expect.arrayContaining([
            expect.objectContaining({
              leaseOwner: { not: null },
              leaseExpiresAt: { gt: expect.any(Date) },
            }),
          ]),
        }),
      }),
    );
    expect(h.tx.run.create).not.toHaveBeenCalled();
  });

  it("rejects reassignment before a human pause", async () => {
    const h = harness({ paused: false });
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 3,
        action: "reassign",
        botId: "bot-b",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.tx.task.update).not.toHaveBeenCalled();
  });

  it("enforces actor Space and user ownership on the original run and target member", async () => {
    const h = harness();
    await h.controls.control(actor, {
      runId: "run-original",
      expectedVersion: 3,
      action: "reassign",
      botId: "bot-b",
    });
    expect(h.prisma.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-original", spaceId: actor.spaceId, userId: actor.userId },
      }),
    );
    expect(h.tx.chatGroupMember.findFirst).toHaveBeenCalledWith({
      where: {
        groupId: "group-1",
        botId: "bot-b",
        bot: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      },
    });
  });

  it("keeps the durable queued run if publishing its job fails", async () => {
    const h = harness();
    h.jobs.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 3,
        action: "resume",
      }),
    ).resolves.toMatchObject({ taskId: "task-1", runId: "run-next" });
    expect(h.tx.run.create).toHaveBeenCalledTimes(1);
    // Re-enqueue is the existing reconciler's responsibility, not an immediate replay here.
    expect(h.jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it("retries interrupted pause teardown without incrementing the paused version", async () => {
    const h = harness({ paused: true, active: 1 });
    await expect(
      h.controls.control(actor, {
        runId: "run-original",
        expectedVersion: 3,
        action: "pause",
      }),
    ).resolves.toMatchObject({ version: 3, paused: true });
    expect(h.tx.task.update).not.toHaveBeenCalled();
    expect(thread.stop).toHaveBeenCalledWith(expect.anything(), actor, expect.anything(), [
      "active-0",
    ]);
    expect(h.jobs.cancel).toHaveBeenCalledTimes(1);
    expect(h.tx.run.create).not.toHaveBeenCalled();
  });
});
