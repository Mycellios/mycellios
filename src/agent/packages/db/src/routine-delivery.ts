import type { Actor } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";

/** Freeze recipients before queuing any work, including an empty list for a raw webhook. */
export async function routineDeliveryRouting(prisma: PrismaClient,
  actor: Pick<Actor, "spaceId" | "userId"> & { botId: string },
  input: { source: "webhook" | "github"; keyDigest: string; routineIds: string[] },
) {
  if (!/^[a-f0-9]{64}$/.test(input.keyDigest) || input.routineIds.length > 5 ||
    input.routineIds.some(id => !id || id.length > 256)) throw new Error("Invalid delivery routing identity");
  const bot = await prisma.bot.findFirst({ where: {
    id: actor.botId, spaceId: actor.spaceId, userId: actor.userId, archivedAt: null,
  }, select: { id: true } });
  if (!bot) throw new IsolationError();
  const scope = { spaceId: actor.spaceId, userId: actor.userId, botId: actor.botId, source: input.source, keyDigest: input.keyDigest };
  const where = { spaceId_userId_botId_source_keyDigest: scope };
  try {
    return await prisma.routineDeliveryReceipt.upsert({ where,
      create: { ...scope, routineIds: [...new Set(input.routineIds)] }, update: {},
    });
  } catch (cause) {
    if (cause && typeof cause === "object" && "code" in cause && cause.code === "P2002") {
      const winner = await prisma.routineDeliveryReceipt.findUnique({ where });
      if (winner) return winner;
    }
    throw cause;
  }
}
