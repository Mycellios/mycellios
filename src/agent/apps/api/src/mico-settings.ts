import { ORPCError } from "@orpc/server";
import { readMicoDefaults, readMicoOverrides, type Actor, type MicoSettingsState, type MicoSettingsUpdate } from "@rakazo/contracts";
import type { Prisma, PrismaClient } from "@rakazo/db";
import { appendEventInTransaction, withTransactionRetry } from "@rakazo/db";

type Store = Pick<Prisma.TransactionClient, "user" | "bot">;
export async function micoSettingsState(db: Store, actor: Actor): Promise<MicoSettingsState> {
  const [user, bots] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { micoDefaults: true, micoSettingsVersion: true } }),
    db.bot.findMany({ where: { userId: actor.userId, spaceId: actor.spaceId, archivedAt: null }, select: { id: true, micoPreferences: true } }),
  ]);
  return { ownerId: actor.userId, spaceId: actor.spaceId, revision: user.micoSettingsVersion, defaults: readMicoDefaults(user.micoDefaults),
    bots: bots.map(bot => ({ id: bot.id, preferences: readMicoOverrides(bot.micoPreferences) })) };
}

/** Owner settings are never part of update_bot or a model-facing tool. */
export function updateMicoSettings(db: PrismaClient, actor: Actor, input: MicoSettingsUpdate) {
  return db.$transaction(async tx => {
    const locked = await tx.user.updateMany({ where: { id: actor.userId, micoSettingsVersion: input.revision },
      data: { micoSettingsVersion: { increment: 1 } } });
    if (locked.count !== 1) throw new ORPCError("CONFLICT", { message: "Preferences changed elsewhere. Reload and try again." });
    if (input.kind === "defaults") {
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { micoDefaults: true } });
      await tx.user.update({ where: { id: actor.userId }, data: { micoDefaults: { ...readMicoDefaults(user.micoDefaults), ...input.patch } } });
    } else {
      const bots = await tx.bot.findMany({ where: { userId: actor.userId, spaceId: actor.spaceId, archivedAt: null,
        ...(input.kind === "bot" ? { id: input.botId } : {}) }, select: { id: true, micoPreferences: true } });
      if (input.kind === "bot" && bots.length !== 1) throw new ORPCError("NOT_FOUND");
      for (const bot of bots) {
        const preferences = readMicoOverrides(bot.micoPreferences);
        if (input.value === null) delete preferences[input.key];
        else preferences[input.key] = input.value;
        await tx.bot.update({ where: { id: bot.id, userId: actor.userId, spaceId: actor.spaceId }, data: { micoPreferences: preferences } });
      }
    }
    return micoSettingsState(tx, actor);
  });
}

/** One field, all owned Micos in the selected Space; no instruction/profile replacement. */
export async function applyMicoBusyMode(db: PrismaClient, actor: Actor, mode: "queue" | "steer" | null, notify: (threadId: string, seq: number) => Promise<unknown>) {
  const changes = await withTransactionRetry(() => db.$transaction(async tx => {
    const bots = await tx.bot.findMany({ where: { userId: actor.userId, spaceId: actor.spaceId, archivedAt: null },
      select: { id: true, name: true, title: true, description: true, thread: { select: { id: true } } }, orderBy: { id: "asc" } });
    // Follow the normal bot-update lock order: thread before bot.
    for (const bot of bots) if (bot.thread) await tx.thread.update({ where: { id: bot.thread.id, userId: actor.userId, spaceId: actor.spaceId }, data: { nextMessageSeq: { increment: 0 } }, select: { id: true } });
    const events: { threadId: string; seq: number }[] = [];
    for (const bot of bots) {
      await tx.bot.update({ where: { id: bot.id, userId: actor.userId, spaceId: actor.spaceId }, data: { busyMessageMode: mode } });
      if (bot.thread) {
        const event = await appendEventInTransaction(tx, { spaceId: actor.spaceId, threadId: bot.thread.id, botId: bot.id, type: "bot.updated",
          payload: { botId: bot.id, name: bot.name, title: bot.title, description: bot.description } });
        events.push({ threadId: bot.thread.id, seq: event.seq });
      }
    }
    return events;
  }));
  await Promise.all(changes.map(change => notify(change.threadId, change.seq).catch(() => undefined)));
  return { ok: true as const };
}
