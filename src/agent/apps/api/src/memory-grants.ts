import type { Actor, MemoryGrantsSetInput, MicoMemoryGrant } from "@mycellios/contracts";
import type { Prisma } from "@mycellios/db";
import { IsolationError } from "@mycellios/db";
import type { RouterDeps } from "./router.js";

type GrantRow = {
  id: string;
  botId: string;
  connectionId: string;
  autoRecall: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function micoMemoryGrantDto(row: GrantRow): MicoMemoryGrant {
  return {
    id: row.id,
    botId: row.botId,
    connectionId: row.connectionId,
    access: "read",
    autoRecall: row.autoRecall,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Per-Mico access to personal memory (specs/mcp-memory, phase 2). Only the person who owns
 * a connection grants it, and only to their own, unarchived Micos in the same Space. There
 * is no model tool for this: Micos, routines and messages can never change a grant.
 */
export function createMemoryGrants(deps: Pick<RouterDeps, "prisma">) {
  const owned = (actor: Actor) => ({ spaceId: actor.spaceId, userId: actor.userId });

  const list = async (actor: Actor): Promise<MicoMemoryGrant[]> => {
    const rows = await deps.prisma.micoMemoryGrant.findMany({
      where: { ...owned(actor), bot: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(micoMemoryGrantDto);
  };

  const set = async (actor: Actor, input: MemoryGrantsSetInput): Promise<MicoMemoryGrant[]> => {
    const rows = await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const connection = await tx.memoryConnection.findFirst({
        where: { id: input.connectionId, ...owned(actor) },
        select: { id: true },
      });
      if (!connection) throw new IsolationError();
      const botIds = input.grants.map((grant) => grant.botId);
      const bots = botIds.length
        ? await tx.bot.findMany({
            where: { id: { in: botIds }, ...owned(actor), archivedAt: null },
            select: { id: true },
          })
        : [];
      if (bots.length !== botIds.length) throw new IsolationError();
      await tx.micoMemoryGrant.deleteMany({
        where: { connectionId: connection.id, ...owned(actor), botId: { notIn: botIds } },
      });
      for (const grant of input.grants) {
        await tx.micoMemoryGrant.upsert({
          where: { botId_connectionId: { botId: grant.botId, connectionId: connection.id } },
          create: {
            ...owned(actor),
            botId: grant.botId,
            connectionId: connection.id,
            autoRecall: grant.autoRecall,
          },
          update: { autoRecall: grant.autoRecall },
        });
      }
      return tx.micoMemoryGrant.findMany({
        where: { connectionId: connection.id, ...owned(actor) },
        orderBy: { createdAt: "asc" },
      });
    });
    return rows.map(micoMemoryGrantDto);
  };

  return { list, set };
}
