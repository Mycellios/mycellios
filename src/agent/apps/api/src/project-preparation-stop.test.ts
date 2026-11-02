import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import { stopThreadRuns, type ThreadTarget } from "./thread-target.js";

it.each([false, true])("Stop preserves unrelated work and steering (legacy task selection: %s)", async (legacy) => {
  const runs = [
    { id: "setup", botId: "bot", threadId: "thread", spaceId: "space", userId: "owner", trigger: "project_prepare", status: "running" },
    { id: "chat", botId: "bot", threadId: "thread", spaceId: "space", userId: "owner", trigger: "user", status: "running" },
  ];
  const steering = [{ runId: "setup" }, { runId: "chat" }, { runId: null }];
  const tx = {
    $queryRaw: vi.fn(),
    externalEffect: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    message: { findMany: vi.fn(async () => []) },
    run: {
      updateManyAndReturn: vi.fn(async ({ where, data }) => runs.filter(row => Object.entries(where).every(([key, value]) => value && typeof value === "object" && "in" in value ? (value as { in: string[] }).in.includes(row[key as keyof typeof row]) : row[key as keyof typeof row] === value)).map(row => { Object.assign(row, data); return row; })),
      findMany: vi.fn(async () => []), findUnique: vi.fn(async () => ({ status: "cancelled" })),
    },
    steeringMessage: { deleteMany: vi.fn(async ({ where }) => { for (let i = steering.length - 1; i >= 0; i--) if (!where.runId || where.runId.in.includes(steering[i]!.runId)) steering.splice(i, 1); }) },
    thread: { update: vi.fn(async () => ({ nextEventSeq: 1 })) },
    event: { create: vi.fn(async ({ data }) => data), deleteMany: vi.fn() },
    computerExecutionLease: { findMany: vi.fn(async () => []) },
    computer: { findMany: vi.fn(async () => []) },
  };
  const prisma = { $transaction: vi.fn(async callback => callback(tx)), computer: { updateMany: vi.fn() }, computerExecutionLease: { updateMany: vi.fn() } } as unknown as PrismaClient;
  const execute = vi.fn();
  await stopThreadRuns({ prisma, events: { notify: vi.fn(async () => undefined) } as never, sandbox: { execute } as never }, { userId: "owner", spaceId: "space" } as Actor, { kind: "bot", botId: "bot", threadId: "thread", bot: {} } as Extract<ThreadTarget, { kind: "bot" }>, legacy ? ["setup"] : { runId: "setup", trigger: "project_prepare" });
  expect(runs.map(row => [row.id, row.status])).toEqual([["setup", "cancelled"], ["chat", "running"]]);
  expect(steering).toEqual([{ runId: "chat" }, { runId: null }]);
  expect(tx.event.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "run.cancelled", runId: "setup" }) }));
  expect(execute).not.toHaveBeenCalled();
});
