import type { PrismaClient } from "./client.js";

/** Called only after the thread and its workflow run were verified as owned. */
export async function isSignedWorkflowThread(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  thread: { taskKey?: string | null; projectKey?: string | null },
): Promise<boolean> {
  if (!thread.taskKey?.startsWith("workflow:") || !thread.projectKey?.startsWith("workflow:")) return false;
  const executionId = thread.taskKey.split(":")[1];
  if (!executionId) return false;
  return Boolean(await prisma.workflowExecution.findFirst({
    where: {
      id: executionId, workflowId: thread.projectKey.slice(9), userId: actor.userId, spaceId: actor.spaceId,
      clientNonce: { startsWith: "workflow-event:" },
    },
    select: { id: true },
  }));
}

export async function isOwnedWorkflowThread(
  prisma: PrismaClient,
  actor: { userId: string; spaceId: string },
  thread: {
    id: string;
    taskBotId?: string | null;
    taskKey?: string | null;
    projectKey?: string | null;
  },
) {
  // Callers may pass a full Run; only identity fields belong in Prisma filters.
  const scope = { userId: actor.userId, spaceId: actor.spaceId };
  if (
    !thread.taskBotId ||
    !thread.taskKey?.startsWith("workflow:") ||
    !thread.projectKey?.startsWith("workflow:")
  )
    return false;
  const execution = await prisma.workflowExecution.findFirst({
    where: {
      id: thread.taskKey.split(":")[1],
      workflowId: thread.projectKey.slice(9),
      ...scope,
    },
    select: { id: true },
  });
  return Boolean(
    execution &&
      (await prisma.run.findFirst({
        where: {
          ...scope,
          threadId: thread.id,
          botId: thread.taskBotId,
          trigger: "workflow",
          clientNonce: thread.taskKey,
        },
        select: { id: true },
      })),
  );
}
