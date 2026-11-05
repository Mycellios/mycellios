import type { PrismaClient } from "./client.js";

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
