import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { JobPublisher } from "@rakazo/adapter-kit";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { Actor, MessageBlock } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { withSerializableRetry } from "./serializable-retry.js";
import type { ThreadTarget } from "./thread-target.js";

type BotTarget = Extract<ThreadTarget, { kind: "bot" }>;
export const PROJECT_PREPARATION_TRIGGER = "project_prepare";
export function projectPreparationNonce(actor: Actor, botId: string, requestId: string) {
  return `project-prepare:${createHash("sha256")
    .update(JSON.stringify([actor.userId, actor.spaceId, botId, requestId]))
    .digest("hex")}`;
}

/** An auxiliary task for the same agent/computer, without a synthetic user message. */
export async function prepareProject(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  actor: Actor,
  target: BotTarget,
  input: { requestId: string; prompt: string },
) {
  const clientNonce = projectPreparationNonce(actor, target.botId, input.requestId);
  const run = await withSerializableRetry(() =>
    deps.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
        const existing = await tx.run.findUnique({
          where: { spaceId_clientNonce: { spaceId: actor.spaceId, clientNonce } },
        });
        if (existing) {
          if (
            existing.botId !== target.botId ||
            existing.threadId !== target.threadId ||
            existing.userId !== actor.userId ||
            existing.spaceId !== actor.spaceId ||
            existing.trigger !== PROJECT_PREPARATION_TRIGGER
          )
            throw new ORPCError("NOT_FOUND");
          return existing;
        }
        const task = await tx.task.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: target.botId,
            threadId: target.threadId,
            prompt: input.prompt,
            status: "queued",
          },
        });
        return tx.run.create({
          data: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            botId: target.botId,
            threadId: target.threadId,
            taskId: task.id,
            status: "queued",
            trigger: PROJECT_PREPARATION_TRIGGER,
            clientNonce,
          },
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
  // Retrying after a lost response or enqueue failure repairs delivery, not execution.
  if (run.status === "queued") await deps.jobs.enqueue(runContinueJob(run.id));
  return { runId: run.id, taskId: run.taskId };
}

export async function ownedProjectPreparation(
  prisma: PrismaClient,
  actor: Actor,
  target: BotTarget,
  runId: string,
) {
  const run = await prisma.run.findFirst({
    where: {
      id: runId,
      botId: target.botId,
      threadId: target.threadId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      trigger: PROJECT_PREPARATION_TRIGGER,
    },
    select: { id: true, status: true, error: true },
  });
  if (!run) throw new ORPCError("NOT_FOUND");
  return run;
}

export async function projectPreparationStatus(
  prisma: PrismaClient,
  actor: Actor,
  target: BotTarget,
  runId: string,
) {
  const run = await ownedProjectPreparation(prisma, actor, target, runId);
  const rows = await prisma.message.findMany({
    where: { threadId: target.threadId, runId, role: "bot" },
    orderBy: { seq: "desc" },
    take: 8,
    select: { blocks: true },
  });
  const detail = rows
    .reverse()
    .flatMap((row) =>
      ((Array.isArray(row.blocks) ? row.blocks : []) as MessageBlock[]).flatMap((block) =>
        block.kind === "text" ? [block.text] : [],
      ),
    )
    .join("\n\n");
  return { status: run.status, detail: (detail || run.error || "").slice(-8000) };
}
