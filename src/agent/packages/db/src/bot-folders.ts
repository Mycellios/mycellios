import type { Actor, BotSection } from "@rakazo/contracts";
import { assertSidebarFolderParent } from "@rakazo/core";
import type { PrismaClient } from "./client.js";
import { BotSectionNameConflictError, IsolationError } from "./scope.js";
import { lockSpaceForContentCreation } from "./spaces.js";

const dto = (folder: { id: string; name: string; parentId: string | null; position: number; createdAt: Date; updatedAt: Date }): BotSection => ({
  id: folder.id, name: folder.name, parentId: folder.parentId, position: folder.position,
  createdAt: folder.createdAt.toISOString(), updatedAt: folder.updatedAt.toISOString(),
});
const scope = (actor: Actor) => ({ spaceId: actor.spaceId, userId: actor.userId });
const translate = (error: unknown): never => {
  if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new BotSectionNameConflictError();
  throw error;
};

/** Scope-locked tree mutations serialize creates, moves and deletes, including subtree validation. */
export function createBotFolderRepos(prisma: PrismaClient) {
  return {
    async createBotSection(actor: Actor, input: { botId?: string; groupId?: string; name: string; parentId?: string | null }) {
      try { return await prisma.$transaction(async tx => {
        await lockSpaceForContentCreation(tx, actor);
        if (input.botId && input.groupId) throw new IsolationError();
        const target = input.botId ? await tx.bot.findFirst({ where: { ...scope(actor), id: input.botId, archivedAt: null }, select: { id: true } })
          : input.groupId ? await tx.chatGroup.findFirst({ where: { ...scope(actor), id: input.groupId, archivedAt: null }, select: { id: true } }) : null;
        if ((input.botId || input.groupId) && !target) throw new IsolationError();
        const folders = await tx.botSection.findMany({ where: scope(actor) });
        const parentId = input.parentId ?? null;
        if (parentId && !folders.some(folder => folder.id === parentId)) throw new IsolationError();
        assertSidebarFolderParent(folders, null, parentId);
        const existing = folders.find(folder => folder.name === input.name);
        if (existing && existing.parentId !== parentId) throw new BotSectionNameConflictError();
        const folder = existing ?? await tx.botSection.create({ data: { ...scope(actor), name: input.name, parentId,
          position: Math.max(-1, ...folders.map(folder => folder.position)) + 1 } });
        if (input.botId) await tx.bot.update({ where: { id: target!.id }, data: { sectionId: folder.id } });
        else if (input.groupId) await tx.chatGroup.update({ where: { id: target!.id }, data: { sectionId: folder.id } });
        return dto(folder);
      }); } catch (error) { return translate(error); }
    },
    async updateBotSection(actor: Actor, input: { sectionId: string; name?: string; parentId?: string | null }) {
      try { return await prisma.$transaction(async tx => {
        await lockSpaceForContentCreation(tx, actor);
        const folders = await tx.botSection.findMany({ where: scope(actor) });
        const existing = folders.find(folder => folder.id === input.sectionId);
        if (!existing) throw new IsolationError();
        const parentId = input.parentId === undefined ? existing.parentId : input.parentId;
        if (parentId && !folders.some(folder => folder.id === parentId)) throw new IsolationError();
        assertSidebarFolderParent(folders, existing.id, parentId);
        if ((input.name === undefined || input.name === existing.name) && parentId === existing.parentId) return dto(existing);
        return dto(await tx.botSection.update({ where: { id: existing.id }, data: { ...(input.name === undefined ? {} : { name: input.name }), parentId } }));
      }); } catch (error) { return translate(error); }
    },
    async deleteBotSection(actor: Actor, input: { sectionId: string }) {
      return prisma.$transaction(async tx => {
        await lockSpaceForContentCreation(tx, actor);
        const locked = await tx.$queryRaw<Array<{ id: string; parentId: string | null }>>`
          SELECT id, "parentId" FROM bot_sections WHERE id = ${input.sectionId}
          AND "spaceId" = ${actor.spaceId} AND "userId" = ${actor.userId} FOR UPDATE`;
        const folder = locked[0];
        if (!folder) throw new IsolationError();
        const where = { ...scope(actor), sectionId: folder.id };
        const releasedBots = await tx.bot.count({ where });
        const releasedGroups = await tx.chatGroup.count({ where });
        // Promote contents to the parent, or Unassigned when removing a root.
        await tx.bot.updateMany({ where, data: { sectionId: folder.parentId } });
        await tx.chatGroup.updateMany({ where, data: { sectionId: folder.parentId } });
        await tx.botSection.updateMany({ where: { ...scope(actor), parentId: folder.id }, data: { parentId: folder.parentId } });
        await tx.botSection.delete({ where: { id: folder.id } });
        return { id: folder.id, releasedBots, releasedGroups };
      });
    },
  };
}
