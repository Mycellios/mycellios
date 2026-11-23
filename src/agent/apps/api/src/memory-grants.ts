import type { Actor, MemoryGrantsSetInput, MicoMemoryGrant } from "@mycellios/contracts";
import { parseStoredMemoryCapabilities } from "@mycellios/contracts";
import type { Prisma } from "@mycellios/db";
import { IsolationError } from "@mycellios/db";
import { ORPCError } from "@orpc/server";
import type { RouterDeps } from "./router.js";

type GrantRow = {
  id: string;
  botId: string;
  connectionId: string;
  access: string;
  allowForget: boolean;
  autoRecall: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function micoMemoryGrantDto(row: GrantRow): MicoMemoryGrant {
  const access = row.access === "read_write" ? "read_write" : "read";
  return {
    id: row.id,
    botId: row.botId,
    connectionId: row.connectionId,
    access,
    allowForget: access === "read_write" && row.allowForget,
    autoRecall: row.autoRecall,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Per-Mico access to personal memory (specs/mcp-memory). Only the person who owns a
 * connection grants it, and only to their own, unarchived Micos in the same Space. There is
 * no model tool for this: Micos, routines and messages can never change a grant.
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
        select: { id: true, capabilities: true },
      });
      if (!connection) throw new IsolationError();
      const capabilities = parseStoredMemoryCapabilities(connection.capabilities);
      const writers = input.grants.filter((grant) => grant.access === "read_write");
      if (writers.length > 0 && !capabilities.write) {
        throw new ORPCError("BAD_REQUEST", { message: "This memory does not accept writes." });
      }
      if (writers.some((grant) => grant.allowForget) && !capabilities.forget) {
        throw new ORPCError("BAD_REQUEST", { message: "This memory cannot forget entries." });
      }
      const botIds = input.grants.map((grant) => grant.botId);
      const bots = botIds.length
        ? await tx.bot.findMany({
            where: { id: { in: botIds }, ...owned(actor), archivedAt: null },
            select: { id: true },
          })
        : [];
      if (bots.length !== botIds.length) throw new IsolationError();
      // A Mico saves to one memory only, so a save never has to guess where it goes.
      if (writers.length > 0) {
        const elsewhere = await tx.micoMemoryGrant.findFirst({
          where: {
            ...owned(actor),
            botId: { in: writers.map((grant) => grant.botId) },
            connectionId: { not: connection.id },
            access: "read_write",
          },
          select: { id: true },
        });
        if (elsewhere) {
          throw new ORPCError("BAD_REQUEST", {
            message:
              "A Mico can save to only one memory. Turn off saving in the other memory first.",
          });
        }
      }
      await tx.micoMemoryGrant.deleteMany({
        where: { connectionId: connection.id, ...owned(actor), botId: { notIn: botIds } },
      });
      for (const grant of input.grants) {
        const fields = {
          autoRecall: grant.autoRecall,
          access: grant.access,
          allowForget: grant.access === "read_write" && grant.allowForget,
        };
        await tx.micoMemoryGrant.upsert({
          where: { botId_connectionId: { botId: grant.botId, connectionId: connection.id } },
          create: { ...owned(actor), botId: grant.botId, connectionId: connection.id, ...fields },
          update: fields,
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
