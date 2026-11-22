import type { Actor } from "@mycellios/contracts";
import { type createDb, reopenSideThreadForSend } from "@mycellios/db";

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
      AND t."deleteAfter" IS NULL
      AND i.id IS NULL
    ORDER BY t."createdAt" DESC,t.id DESC
    LIMIT 200
    ON CONFLICT DO NOTHING
  `;
}

/** A message sent from a Mico tab brings an archived conversation back, Tasks included.
 * Call it inside the send transaction: it takes the thread lock that archive also takes, so
 * a concurrent archive either lands first and is undone, or sees the new run and refuses.
 * History, read state and the inbox entry are kept; only the archive mark is cleared on the
 * thread and its inbox mirror. A conversation being deleted refuses the send instead.
 */
export function restoreArchivedTaskOnSend(
  tx: Pick<ReturnType<typeof createDb>["prisma"], "$queryRaw" | "$executeRaw">,
  actor: Pick<Actor, "userId" | "spaceId">,
  threadId: string,
) {
  return reopenSideThreadForSend(tx, actor, threadId);
}
