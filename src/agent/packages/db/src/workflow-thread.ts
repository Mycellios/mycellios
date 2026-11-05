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
      ...actor,
    },
    select: { id: true },
  });
  return Boolean(
    execution &&
      (await prisma.run.findFirst({
        where: {
          ...actor,
          threadId: thread.id,
          botId: thread.taskBotId,
          trigger: "workflow",
          clientNonce: thread.taskKey,
        },
        select: { id: true },
      })),
  );
}
