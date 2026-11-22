import type { Actor } from "@mycellios/contracts";
import type { PrismaClient } from "./client.js";

export const MESSAGE_PIN_LIMIT = 100;

export function listMessagePins(prisma: PrismaClient, actor: Actor, threadId: string) {
  return prisma.$queryRaw<Array<{messageId:string;pinnedAt:Date}>>`
    SELECT "messageId","pinnedAt" FROM message_pins
    WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId}
    ORDER BY "pinnedAt" DESC,"messageId" LIMIT ${MESSAGE_PIN_LIMIT}`;
}

/** Caller resolves the owned conversation and visible message before entering. No content is copied. */
export async function setMessagePin(prisma: PrismaClient, actor: Actor, threadId: string, messageId: string, pinned: boolean) {
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.spaceId,actor.userId,threadId])},0))::text AS "lock"`;
    if (!pinned) {
      await tx.$executeRaw`DELETE FROM message_pins WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId} AND "messageId"=${messageId}`;
      return;
    }
    const existing=await tx.$queryRaw<Array<{messageId:string}>>`SELECT "messageId" FROM message_pins WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId}`;
    if(existing.some(pin=>pin.messageId===messageId)) return;
    if(existing.length>=MESSAGE_PIN_LIMIT) throw new Error("You can pin up to 100 messages per conversation.");
    await tx.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId") VALUES (${messageId},${threadId},${actor.spaceId},${actor.userId}) ON CONFLICT ("messageId","userId") DO NOTHING`;
  });
}
