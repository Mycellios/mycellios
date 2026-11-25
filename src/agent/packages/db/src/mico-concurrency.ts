import type { Prisma, PrismaClient } from "./client.js";

/**
 * Whether the operator lets native engines run several conversations at once
 * (specs/native-engines/spec.md phase 4). Off unless MYCELLIOS_NATIVE_CONCURRENCY is 1 or true
 * on both the API and the worker; while it is off every native Mico runs one turn at a time in
 * total, main chat included.
 */
export function nativeConcurrencyEnabled(env: Record<string, string | undefined> = process.env) {
  const value = env.MYCELLIOS_NATIVE_CONCURRENCY;
  return value === "1" || value === "true";
}

/**
 * Native engines whose turns can run side by side: each conversation keeps its own session
 * folder, CLI process and per-run MCP bridge token, and the CLI acts only through the Mico's
 * tools. A generic ACP agent is an operator command that never says whether two of its
 * sessions may run at once, so it stays at one turn.
 */
const CONCURRENT_NATIVE_ENGINES: ReadonlySet<string> = new Set(["codex", "claude", "opencode"]);

/**
 * Whether a Mico runs its side conversations in parallel lanes, with a main chat lane of its
 * own: always for Pi, and for Codex, Claude Code and OpenCode while native concurrency is on.
 */
export function micoRunsLanes(
  bot: { agentEngine: string },
  nativeConcurrency = nativeConcurrencyEnabled(),
) {
  return (
    bot.agentEngine === "pi" ||
    (nativeConcurrency && CONCURRENT_NATIVE_ENGINES.has(bot.agentEngine))
  );
}

/**
 * How many turns a Mico runs at once. A Mico with lanes admits up to its conversation limit
 * (taskConcurrency, 1-4) of turns outside its main chat; the main chat is its own lane and
 * never waits behind them. Any other native engine runs one turn at a time in total, main chat
 * included.
 */
export function micoTurnLimit(
  bot: { agentEngine: string; taskConcurrency: number },
  nativeConcurrency = nativeConcurrencyEnabled(),
) {
  return micoRunsLanes(bot, nativeConcurrency) ? bot.taskConcurrency : 1;
}

/** Whether a Mico's turns in its main chat count toward its limit (only Micos without lanes). */
export function mainChatCountsTowardLimit(
  bot: { agentEngine: string },
  nativeConcurrency = nativeConcurrencyEnabled(),
) {
  return !micoRunsLanes(bot, nativeConcurrency);
}

/** Run filter for the turns that use one of the Mico's conversation slots. */
export function slotRunsWhere(
  bot: {
    agentEngine: string;
    mainThreadId: string | null | undefined;
  },
  nativeConcurrency = nativeConcurrencyEnabled(),
): Prisma.RunWhereInput {
  return mainChatCountsTowardLimit(bot, nativeConcurrency) || !bot.mainThreadId
    ? {}
    : { threadId: { not: bot.mainThreadId } };
}

/** Admission is atomic across worker processes; queued runs do not consume slots. */
export async function claimMicoRun(
  prisma: PrismaClient,
  run: { id: string; botId: string; spaceId: string; userId: string; threadId: string },
  where: Prisma.RunWhereInput,
  data: Prisma.RunUpdateManyMutationInput,
) {
  // Read once, so one admission never mixes both rules.
  const nativeConcurrency = nativeConcurrencyEnabled();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM bots WHERE id=${run.botId} AND "spaceId"=${run.spaceId} AND "userId"=${run.userId} FOR UPDATE`;
    const bot = await tx.bot.findFirst({
      where: { id: run.botId, spaceId: run.spaceId, userId: run.userId, archivedAt: null },
      select: { taskConcurrency: true, agentEngine: true, thread: { select: { id: true } } },
    });
    if (!bot) return { count: 0 };
    const live = {
      botId: run.botId,
      spaceId: run.spaceId,
      userId: run.userId,
      id: { not: run.id },
      status: { in: ["leased", "running"] },
      leaseExpiresAt: { gt: new Date() },
    };
    // The main chat's lane: one turn at a time there, never counted against the slots.
    const mainLane =
      !mainChatCountsTowardLimit(bot, nativeConcurrency) && bot.thread?.id === run.threadId;
    if (
      (!mainLane &&
        (await tx.run.count({
          where: {
            ...live,
            ...slotRunsWhere(
              { agentEngine: bot.agentEngine, mainThreadId: bot.thread?.id },
              nativeConcurrency,
            ),
          },
        })) >= micoTurnLimit(bot, nativeConcurrency)) ||
      (await tx.run.count({ where: { ...live, threadId: run.threadId } }))
    )
      return { count: 0 };
    return tx.run.updateMany({
      where: {
        AND: [
          where,
          {
            id: run.id,
            botId: run.botId,
            threadId: run.threadId,
            userId: run.userId,
            spaceId: run.spaceId,
          },
        ],
      },
      data,
    });
  });
}
