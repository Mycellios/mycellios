import { ORPCError } from "@orpc/server";
import type { Actor, ConversationContext } from "@mycellios/contracts";
import { catalogContextWindow } from "@mycellios/adapters";
import type { RouterDeps } from "./router.js";

/** Recent turns are enough to find the latest answer without scanning the whole history. */
const RECENT_RUNS = 10;

type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

/**
 * Tokens the latest answer read and wrote. Input is uncached; cache reads and writes are
 * the rest of what the model read, and the reply joins the conversation for the next turn.
 */
export function conversationTokens(usage: Usage): number {
  return [usage.inputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.outputTokens]
    .reduce<number>((sum, value) => sum + (typeof value === "number" && value > 0 ? value : 0), 0);
}

/**
 * How full a Mico's main chat (or one of its own side conversations) was at its latest
 * answer. Owner and Space are checked before reading any usage; nothing is estimated.
 */
export async function threadContext(
  deps: RouterDeps,
  actor: Actor,
  input: { botId: string; taskThreadId?: string },
  windowOf: (provider: string, model: string) => number | null = catalogContextWindow,
): Promise<ConversationContext | null> {
  const owner = { userId: actor.userId, spaceId: actor.spaceId };
  const thread = await deps.prisma.thread.findFirst({
    where: input.taskThreadId
      ? { ...owner, id: input.taskThreadId, taskBotId: input.botId }
      : { ...owner, botId: input.botId },
    select: { id: true },
  });
  if (!thread) {
    const bot = await deps.prisma.bot.findFirst({ where: { ...owner, id: input.botId }, select: { id: true } });
    if (!bot || input.taskThreadId) throw new ORPCError("NOT_FOUND");
    return null;
  }
  const runs = await deps.prisma.run.findMany({
    where: { ...owner, threadId: thread.id },
    orderBy: { createdAt: "desc" },
    take: RECENT_RUNS,
    select: { id: true },
  });
  if (!runs.length) return null;
  const last = await deps.prisma.usageRecord.findFirst({
    where: { ...owner, runId: { in: runs.map((run) => run.id) }, operationKind: "answer" },
    orderBy: { createdAt: "desc" },
    select: {
      provider: true, model: true, createdAt: true,
      inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true,
    },
  });
  if (!last) return null;
  const usedTokens = conversationTokens(last);
  if (!usedTokens) return null;
  return {
    model: last.model,
    at: last.createdAt.toISOString(),
    usedTokens,
    contextWindow: windowOf(last.provider, last.model),
  };
}
