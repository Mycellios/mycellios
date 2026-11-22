import type { Actor } from "@mycellios/contracts";
import type { createDb } from "@mycellios/db";

/** Materialize navigation metadata only; never send, resume or create a Run.
 * Existing inbox entries own their read/archive state and are never replaced.
 */
export async function discoverTaskConversations(db: Pick<ReturnType<typeof createDb>["prisma"], "$executeRaw">, actor: Actor) {
  return db.$executeRaw`
    INSERT INTO task_inbox
      (id,"spaceId","userId","botId","threadId","clientNonce",title,"readSeq","createdAt")
    SELECT 'conversation:' || t.id,t."spaceId",t."userId",t."taskBotId",t.id,
      'conversation:' || t.id,COALESCE(NULLIF(btrim(t.title),''),'Conversation'),
      t."lastReadSeq",t."createdAt"
    FROM threads t
    JOIN bots b ON b.id=t."taskBotId" AND b."spaceId"=t."spaceId" AND b."archivedAt" IS NULL
    LEFT JOIN task_inbox i ON i."threadId"=t.id
    WHERE t."spaceId"=${actor.spaceId} AND t."userId"=${actor.userId}
      AND t."taskBotId" IS NOT NULL AND t."botId" IS NULL AND t."groupId" IS NULL
      AND COALESCE(t."projectKey",'') NOT LIKE 'routine:%'
      AND COALESCE(t."projectKey",'') NOT LIKE 'workflow:%'
      AND COALESCE(t."taskKey",'') NOT LIKE 'routine:%'
      AND COALESCE(t."taskKey",'') NOT LIKE 'workflow:%'
      AND COALESCE(t."taskKey",'') NOT LIKE 'mico-task:%:inbox:%'
      AND i.id IS NULL
    ORDER BY t."createdAt" DESC,t.id DESC
    LIMIT 200
    ON CONFLICT DO NOTHING
  `;
}

/** A message sent from a Mico tab brings an archived conversation back to the Tasks inbox.
 * Call it inside the send transaction: it takes the thread lock that archive also takes, so
 * a concurrent archive either lands first and is undone, or sees the new run and refuses.
 * History, read state and the entry itself are kept; only the archive mark is cleared.
 */
export async function restoreArchivedTaskOnSend(
  tx: Pick<ReturnType<typeof createDb>["prisma"], "$queryRaw" | "$executeRaw">,
  actor: Pick<Actor, "userId" | "spaceId">,
  threadId: string,
) {
  await tx.$queryRaw`SELECT id FROM threads WHERE id=${threadId} AND "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} FOR UPDATE`;
  return tx.$executeRaw`
    UPDATE task_inbox SET "archivedAt"=NULL,"reminderClaimedAt"=NULL
    WHERE "threadId"=${threadId} AND "spaceId"=${actor.spaceId} AND "userId"=${actor.userId}
      AND "archivedAt" IS NOT NULL
  `;
}
