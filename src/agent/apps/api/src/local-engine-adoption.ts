import type { Actor } from "@mycellios/contracts";
import { ACTIVE_RUN_STATUSES } from "@mycellios/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  type PrismaClient,
  withTransactionRetry,
} from "@mycellios/db";

/** At most this many Micos are checked per call, so one Desktop start stays bounded. */
export const LOCAL_ENGINE_ADOPTION_LIMIT = 24;
/** Delegated work that is not finished keeps a Mico on its engine. */
const UNFINISHED_DELEGATION = ["queued", "running", "waiting", "waiting_event", "paused"];
const ENGINE_NAMES = { claude: "Claude Code", codex: "Codex" } as const;

export function localEngineAdoptionNote(engine: keyof typeof ENGINE_NAMES) {
  return `This Mico now uses ${ENGINE_NAMES[engine]} on this PC. To go back to its model, choose it in the model menu.`;
}

/**
 * The one-time move of existing This PC Micos to a CLI signed in on their PC. Only an idle Mico
 * (no active, queued or waiting run, no unfinished delegated work) that still runs on Pi and was
 * never moved changes; its saved model stays as the server fallback. A skipped Mico changes
 * nothing and may move on a later call; a moved one is recorded so it never moves again.
 */
export async function adoptLocalEngines(
  prisma: PrismaClient,
  actor: Actor,
  engineFor: (botId: string) => Promise<"claude" | "codex" | undefined>,
) {
  const candidates = await prisma.bot.findMany({
    where: {
      userId: actor.userId, spaceId: actor.spaceId, archivedAt: null, agentEngine: "pi",
      localEngineAdoptedAt: null, computer: { kind: "desktop", scope: "dedicated" },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: LOCAL_ENGINE_ADOPTION_LIMIT,
  });
  const adopted: Array<{ botId: string; engine: "claude" | "codex" }> = [];
  for (const { id: botId } of candidates) {
    const engine = await engineFor(botId).catch(() => undefined);
    if (!engine) continue;
    const moved = await withTransactionRetry(() => prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM bots WHERE id = ${botId} FOR UPDATE`;
      const bot = await tx.bot.findFirst({
        where: {
          id: botId, userId: actor.userId, spaceId: actor.spaceId, archivedAt: null, agentEngine: "pi",
          localEngineAdoptedAt: null, computer: { kind: "desktop", scope: "dedicated" },
        },
        select: { id: true, thread: { select: { id: true } } },
      });
      if (!bot?.thread) return false;
      const busy = await tx.run.findFirst({
        where: { botId, status: { in: [...ACTIVE_RUN_STATUSES] } }, select: { id: true },
      }) ?? await tx.task.findFirst({
        where: { botId, delegationState: { in: UNFINISHED_DELEGATION } }, select: { id: true },
      });
      if (busy) return false;
      await tx.bot.update({ where: { id: botId }, data: { agentEngine: engine, localEngineAdoptedAt: new Date() } });
      const blocks = [{ kind: "meta" as const, text: localEngineAdoptionNote(engine) }];
      const message = await createThreadMessageInTransaction(tx, {
        threadId: bot.thread.id, botId, role: "system", blocks,
        clientNonce: `local-engine-adoption:${botId}`, markUnread: false,
      });
      await appendEventInTransaction(tx, {
        spaceId: actor.spaceId, threadId: bot.thread.id, botId, type: "thread.message.created",
        payload: { messageId: message.id, role: "system", blocks },
      });
      return true;
    }));
    if (moved) adopted.push({ botId, engine });
  }
  return adopted;
}
