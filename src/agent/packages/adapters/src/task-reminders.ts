import type { NotificationProvider } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { runAsSystem } from "@mycellios/db";

/** Existing worker reconciliation owns the clock; no model run or browser timer. */
export async function reconcileTaskReminders(deps: {
  prisma: PrismaClient;
  notifications: NotificationProvider;
  now?: Date;
}): Promise<void> {
  const now = deps.now ?? new Date();
  await runAsSystem("deliver explicitly scheduled conversation reminders", async () => {
    const rows = await deps.prisma.$queryRaw<Array<{
      id: string; userId: string; spaceId: string; botId: string;
      threadId: string; title: string; remindAt: Date;
    }>>`UPDATE task_inbox i SET "reminderClaimedAt"=${now}
      WHERE i.id IN (SELECT c.id FROM task_inbox c
        JOIN bots b ON b.id=c."botId" AND b."spaceId"=c."spaceId" AND b."archivedAt" IS NULL
        JOIN threads t ON t.id=c."threadId" AND t."spaceId"=c."spaceId" AND t."userId"=c."userId" AND t."taskBotId"=c."botId"
        WHERE c."archivedAt" IS NULL AND t."archivedAt" IS NULL AND t."deleteAfter" IS NULL
          AND c."remindAt"<=${now} AND c."reminderNotifiedAt" IS NULL
          AND (c."reminderClaimedAt" IS NULL OR c."reminderClaimedAt"<${new Date(now.getTime()-300000)})
          AND EXISTS (SELECT 1 FROM space_members m WHERE m."spaceId"=c."spaceId" AND m."userId"=c."userId")
        ORDER BY c."remindAt",c.id LIMIT 100 FOR UPDATE OF c SKIP LOCKED)
      RETURNING i.id,i."userId",i."spaceId",i."botId",i."threadId",i.title,i."remindAt"`;
    for (const row of rows) {
      try {
        // Cancellation/rescheduling between claim and dispatch must not send an old reminder.
        // The thread holds the archive; the inbox mark is a mirror that keeps the due index small.
        const current = await deps.prisma.inboxTask.findFirst({where:{id:row.id,thread:{archivedAt:null,deleteAfter:null},remindAt:row.remindAt,reminderClaimedAt:now}});
        if (!current) continue;
        const context = {userId:row.userId,spaceId:row.spaceId,operationId:`task-reminder:${row.id}:${row.remindAt.toISOString()}`,traceId:row.id,signal:AbortSignal.timeout(20000)};
        const message = {kind:"takeover" as const,title:"Mycellios · Reminder",body:row.title,botId:row.botId,threadId:row.threadId,taskThreadId:row.threadId,taskReminder:{id:row.id,at:row.remindAt.toISOString()}};
        const accepted = deps.notifications.deliver
          ? await deps.notifications.deliver(message,context)==="delivered"
          : (await deps.notifications.send(message,context),true);
        if(accepted) await deps.prisma.inboxTask.updateMany({where:{id:row.id,remindAt:row.remindAt,reminderClaimedAt:now},data:{reminderNotifiedAt:now,reminderClaimedAt:null}});
      } catch(cause) {
        getLogger().warn("Task reminder delivery unavailable");
      } finally {
        // No configured recipient is not delivery; retry later, retaining the due marker.
        await deps.prisma.inboxTask.updateMany({where:{id:row.id,remindAt:row.remindAt,reminderClaimedAt:now},data:{reminderClaimedAt:null}});
      }
    }
  });
}
