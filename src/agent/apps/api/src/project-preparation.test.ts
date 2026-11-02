import type { Actor } from "@rakazo/contracts";
import type { JobPublisher } from "@rakazo/adapter-kit";
import type { PrismaClient } from "@rakazo/db";
import { expect, it, vi } from "vitest";
import { ownedProjectPreparation, prepareProject, projectPreparationNonce, projectPreparationStatus } from "./project-preparation.js";
import type { ThreadTarget } from "./thread-target.js";

const actor = { userId: "owner", spaceId: "space", email: "owner@example.test", isDeploymentOwner: false } satisfies Actor;
const target = { kind: "bot", botId: "bot", threadId: "thread", bot: {} } as Extract<ThreadTarget, { kind: "bot" }>;
const input = { requestId: "6fffa8ba-04af-4712-8e5f-49d12b38b71c", prompt: "Inspect the existing project and prepare run.json" };

function fixture() {
  const runs: Record<string, unknown>[] = [];
  const tasks: Record<string, unknown>[] = [];
  const tx = {
    $queryRaw: vi.fn(async () => []),
    message: { create: vi.fn(() => { throw new Error("Preparation must not send a chat message"); }) },
    task: { create: vi.fn(async ({ data }) => { const row = { id: `task-${tasks.length}`, ...data }; tasks.push(row); return row; }) },
    run: {
      findUnique: vi.fn(async ({ where }) => runs.find(run => run.spaceId === where.spaceId_clientNonce.spaceId && run.clientNonce === where.spaceId_clientNonce.clientNonce) ?? null),
      create: vi.fn(async ({ data }) => { const row = { id: `run-${runs.length}`, ...data }; runs.push(row); return row; }),
      findFirst: vi.fn(async ({ where }) => runs.find(run => Object.entries(where).every(([key, value]) => run[key] === value)) ?? null),
    },
  };
  const messages = vi.fn(async () => [] as Array<{ blocks: unknown[] }>);
  const prisma = { ...tx, message: { ...tx.message, findMany: messages }, $transaction: vi.fn(async callback => callback(tx)) } as unknown as PrismaClient;
  const enqueue = vi.fn(async () => undefined);
  return { runs, tasks, tx, messages, prisma, enqueue, deps: { prisma, jobs: { enqueue } as unknown as JobPublisher } };
}

it("creates a separate task on the same agent/thread without a user message or steering", async () => {
  const f = fixture();
  const receipt = await prepareProject(f.deps, actor, target, input);
  expect(receipt).toEqual({ runId: "run-0", taskId: "task-0" });
  expect(f.tasks[0]).toMatchObject({ prompt: input.prompt, botId: target.botId, threadId: target.threadId });
  expect(f.runs[0]).toMatchObject({ trigger: "project_prepare", userId: actor.userId, spaceId: actor.spaceId });
  expect(f.runs[0]).not.toHaveProperty("sourceMessageId");
  expect(f.tx.message.create).not.toHaveBeenCalled();
  expect(f.enqueue).toHaveBeenCalledWith(expect.objectContaining({ name: "run.continue", payload: { runId: "run-0" } }));
});

it("reuses the same run and repairs queue delivery after an enqueue failure", async () => {
  const f = fixture();
  f.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
  await expect(prepareProject(f.deps, actor, target, input)).rejects.toThrow("queue unavailable");
  await expect(prepareProject(f.deps, actor, target, input)).resolves.toEqual({ runId: "run-0", taskId: "task-0" });
  expect(f.tasks).toHaveLength(1); expect(f.runs).toHaveLength(1);
  f.runs[0]!.status = "completed";
  await prepareProject(f.deps, actor, target, input);
  expect(f.enqueue).toHaveBeenCalledTimes(2);
});

it("isolates idempotency by owner, Space and agent", () => {
  const keys = [
    projectPreparationNonce(actor, "bot", input.requestId),
    projectPreparationNonce({ ...actor, userId: "other" }, "bot", input.requestId),
    projectPreparationNonce({ ...actor, spaceId: "other" }, "bot", input.requestId),
    projectPreparationNonce(actor, "other", input.requestId),
  ];
  expect(new Set(keys).size).toBe(4);
});

it("rejects status and cancellation admission for a different owner, Space, agent or trigger", async () => {
  const f = fixture();
  await prepareProject(f.deps, actor, target, input);
  for (const [who, which] of [
    [{ ...actor, userId: "other" }, target],
    [{ ...actor, spaceId: "other" }, target],
    [actor, { ...target, botId: "other" }],
    [actor, { ...target, threadId: "other" }],
  ] as const) {
    await expect(ownedProjectPreparation(f.prisma, who, which, "run-0")).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  f.runs[0]!.trigger = "user";
  await expect(ownedProjectPreparation(f.prisma, actor, target, "run-0")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("returns only bounded textual details for the owned auxiliary run", async () => {
  const f = fixture();
  await prepareProject(f.deps, actor, target, input);
  f.messages.mockResolvedValue([{ blocks: [{ kind: "text", text: "x".repeat(9000) }, { kind: "steps", steps: [] }] }]);
  const result = await projectPreparationStatus(f.prisma, actor, target, "run-0");
  expect(result.status).toBe("queued"); expect(result.detail).toHaveLength(8000);
  expect(f.messages).toHaveBeenCalledWith(expect.objectContaining({ where: { threadId: "thread", runId: "run-0", role: "bot" } }));
});
