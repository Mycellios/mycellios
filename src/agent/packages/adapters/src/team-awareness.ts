import { runContinueJob, runJobKey } from "@mycellios/adapter-kit";
import type { MessageBlock } from "@mycellios/contracts";
import { ACTIVE_RUN_STATUSES, resolveBotAddress } from "@mycellios/core";
import {
  appendEventInTransaction,
  createThreadMessageInTransaction,
  stopTeammateRunsInTransaction,
  teammateRunsForCaller,
  withTransactionRetry,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import type { ExecutorDeps } from "./executor.js";
import { reconcileWorkStops } from "./work-stop-reconciler.js";

type Scope = { spaceId: string; userId: string };

/** A teammate's description as list_agents returns it. */
export const LIST_AGENTS_DESCRIPTION_MAX_LENGTH = 300;
const LIST_AGENTS_LIMIT = 40;

export type TeammateStatus = {
  id: string;
  name: string;
  title: string;
  description: string;
  /** working: a turn runs; queued: a turn waits to start; ready: nothing to do. */
  status: "working" | "queued" | "ready";
  queuedMessages: number;
  turnStartedAt?: string;
  /** What a working teammate waits for, when it waits on the person. */
  waitingFor?: "answer_or_approval" | "takeover";
  lastActivityAt?: string;
  openWaits: number;
};

/**
 * list_agents: every other Mico of the person in this Space with what it is doing now, so a
 * Mico checks its team before browsing, asking the person to sign in or starting work someone
 * else may already have open. Read-only; it never wakes anyone.
 */
export async function listAgents(
  deps: Pick<ExecutorDeps, "prisma">,
  caller: Scope & { botId: string },
): Promise<{ agents: TeammateStatus[]; truncated: boolean }> {
  const bots = await deps.prisma.bot.findMany({
    where: {
      spaceId: caller.spaceId,
      userId: caller.userId,
      archivedAt: null,
      id: { not: caller.botId },
    },
    select: { id: true, name: true, title: true, description: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: LIST_AGENTS_LIMIT + 1,
  });
  const listed = bots.slice(0, LIST_AGENTS_LIMIT);
  const ids = listed.map((bot) => bot.id);
  const scope = { spaceId: caller.spaceId, userId: caller.userId, botId: { in: ids } };
  const [active, latest, waits] = ids.length
    ? await Promise.all([
        deps.prisma.run.findMany({
          where: { ...scope, status: { in: [...ACTIVE_RUN_STATUSES] } },
          select: { botId: true, status: true, startedAt: true },
          take: 400,
        }),
        deps.prisma.run.groupBy({ by: ["botId"], where: scope, _max: { updatedAt: true } }),
        deps.prisma.task.groupBy({
          by: ["botId"],
          where: { ...scope, delegationState: "waiting_event" },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];
  const lastBy = new Map(latest.map((row) => [row.botId, row._max.updatedAt]));
  const waitsBy = new Map(waits.map((row) => [row.botId, row._count._all]));
  const agents = listed.map((bot): TeammateStatus => {
    const runs = active.filter((run) => run.botId === bot.id);
    const working = runs.filter((run) => run.status !== "queued");
    const queued = runs.filter((run) => run.status === "queued").length;
    const started = working
      .map((run) => run.startedAt)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const waitingFor = working.some((run) => run.status === "waiting_takeover")
      ? "takeover"
      : working.some((run) => run.status === "waiting_input")
        ? "answer_or_approval"
        : undefined;
    const last = lastBy.get(bot.id);
    return {
      id: bot.id,
      name: bot.name,
      title: bot.title ?? "",
      description: (bot.description ?? "").slice(0, LIST_AGENTS_DESCRIPTION_MAX_LENGTH),
      status: working.length ? "working" : queued ? "queued" : "ready",
      queuedMessages: queued,
      ...(started ? { turnStartedAt: started.toISOString() } : {}),
      ...(waitingFor ? { waitingFor } : {}),
      ...(last ? { lastActivityAt: last.toISOString() } : {}),
      openWaits: waitsBy.get(bot.id) ?? 0,
    };
  });
  return { agents, truncated: bots.length > LIST_AGENTS_LIMIT };
}

/**
 * interrupt_agent: stop a teammate's turns that work on this Mico's own messages, through the
 * same durable Stop the person uses (cancellation, dropped queue, computer teardown outbox).
 * Turns the person, a routine or another Mico started are refused: only the person stops them.
 * The teammate's chat records who stopped it and why; answers it already sent stay.
 */
export async function interruptAgent(
  deps: Pick<ExecutorDeps, "prisma" | "events" | "jobs" | "sandbox">,
  caller: Scope & { botId: string; name: string },
  input: { bot_id?: string; confirm_name?: string; reason: string },
) {
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) return { error: "say in one line why the work should stop" } as const;
  const bots = await deps.prisma.bot.findMany({
    where: { spaceId: caller.spaceId, userId: caller.userId, archivedAt: null },
    select: { id: true, name: true, thread: { select: { id: true } } },
  });
  const target = resolveBotAddress(bots, { botId: input.bot_id, name: input.confirm_name });
  if (!target) return { error: "no bot found with that id or name" } as const;
  if (target.id === caller.botId)
    return { error: "use your own Stop rules; you cannot interrupt yourself" } as const;
  const { ownRunIds, otherActive } = await teammateRunsForCaller(deps.prisma, {
    ...caller,
    callerBotId: caller.botId,
    targetBotId: target.id,
  });
  if (!ownRunIds.length) {
    return {
      error: otherActive
        ? `${target.name} is working on something you did not send it (the person, a routine or another teammate started it). Only the person can stop that; tell them if it should stop.`
        : `${target.name} is not working on anything you sent it.`,
    } as const;
  }
  const committed = await withTransactionRetry(() =>
    deps.prisma.$transaction(async (tx) => {
      const stopped = await stopTeammateRunsInTransaction(
        tx,
        caller,
        ownRunIds,
        "interrupted_by_teammate",
      );
      if (!stopped.runIds.length || !target.thread) return { ...stopped, notice: null };
      // The teammate learns who stopped it and why, without starting a turn.
      const block: MessageBlock = {
        kind: "bot_message_received",
        fromBotId: caller.botId,
        fromBotName: caller.name,
        text: `I stopped the work I asked you for. Reason: ${reason}`,
        intent: "fyi",
      };
      const message = await createThreadMessageInTransaction(tx, {
        threadId: target.thread.id,
        role: "user",
        blocks: [block],
        markUnread: false,
      });
      const event = await appendEventInTransaction(tx, {
        spaceId: caller.spaceId,
        threadId: target.thread.id,
        botId: target.id,
        type: "thread.message.created",
        payload: { messageId: message.id, role: "user", blocks: [block] },
      });
      return { ...stopped, notice: { threadId: target.thread.id, seq: event.seq } };
    }),
  );
  if (!committed.runIds.length)
    return { error: `${target.name} already finished that work.` } as const;
  for (const notice of [...committed.notices, ...(committed.notice ? [committed.notice] : [])]) {
    await deps.events
      .notify(notice.threadId, notice.seq)
      .catch((error) => getLogger().error("interrupt_agent notification", error));
  }
  await Promise.allSettled(committed.runIds.map((runId) => deps.jobs.cancel(runJobKey(runId))));
  if (committed.teardownTaskIds.length && deps.sandbox) {
    await reconcileWorkStops(
      { prisma: deps.prisma, sandbox: deps.sandbox, jobs: deps.jobs, events: deps.events },
      { spaceId: caller.spaceId, userId: caller.userId, taskIds: committed.teardownTaskIds },
    ).catch((error) => {
      // The outbox keeps the teardown; the reconciler retries it.
      getLogger().warn("interrupt_agent teardown pending", { error: String(error) });
    });
  }
  for (const runId of committed.resumeRunIds) {
    await deps.jobs
      .enqueue(runContinueJob(runId))
      .catch((error) => getLogger().error("interrupt_agent resume enqueue", error));
  }
  return {
    ok: true,
    botId: target.id,
    name: target.name,
    stopped: committed.runIds.length,
    note: `${target.name} stopped the work you asked for. Anything it already sent you stays; nothing more will come from that work.`,
  };
}
