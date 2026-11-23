import { ORPCError } from "@orpc/server";
import {
  canInstallNativeOpenCode, discoverNativeCodexModels, discoverNativeCodexQuota, discoverNativeEngines, installManagedOpenCode,
  nativeHostAccess, reconcileWorkStops,
} from "@mycellios/adapters";
import { createTaskControls } from "../task-controls.js";
import { createAcpRegistry } from "../acp-registry.js";
import {
  awaitingRepliesForThread, awaitingReplyRun, closeEventWait, controlWorkTree, hideAwaitingReplies, listEventWaits,
  workStatus, IsolationError,
} from "@mycellios/db";
import { resolveThreadTarget, stopThreadRuns } from "../thread-target.js";
import type { RouterContext } from "./context.js";
import { codingEnginesForComputer } from "./shared.js";

export function localCapabilityRoutes({ authed, deps, repos }: RouterContext) {
  const acpRegistry = createAcpRegistry();
  let quota: { at: number; value: Awaited<ReturnType<typeof discoverNativeCodexQuota>> } | undefined;
  let pendingQuota: ReturnType<typeof discoverNativeCodexQuota> | undefined;
  return {
    engines: {
      forBot: authed.engines.forBot.handler(async ({ context, input }) => {
        const bot = await repos.getBot(context.actor, input.botId);
        return codingEnginesForComputer(deps, context.actor, bot, context.signal);
      }),
      codexQuota: authed.engines.codexQuota.handler(async ({ context }) => {
        // Check on every request, including cached reads, so revocation is immediate.
        if (!(await nativeHostAccess(deps.dataDir, context.actor))) return null;
        if (quota && Date.now() - quota.at < 60_000) return quota.value;
        pendingQuota ??= discoverNativeCodexQuota(deps.dataDir).catch(() => null);
        try {
          const value = await pendingQuota;
          quota = { at: Date.now(), value };
          return value;
        } finally { pendingQuota = undefined; }
      }),
      codexModels: authed.engines.codexModels.handler(async ({ context }) => {
        if (!(await nativeHostAccess(deps.dataDir, context.actor))) throw new ORPCError("FORBIDDEN");
        return discoverNativeCodexModels(deps.dataDir);
      }),
      list: authed.engines.list.handler(async ({ context }) =>
        (await nativeHostAccess(deps.dataDir, context.actor))
          ? discoverNativeEngines(deps.dataDir)
          : [{ id: "pi" as const, name: "Pi", available: true }],
      ),
      installOpenCode: authed.engines.installOpenCode.handler(async ({ context }) => {
        if (!deps.dataDir || !(await canInstallNativeOpenCode(deps.dataDir, context.actor))) {
          throw new ORPCError("FORBIDDEN");
        }
        try {
          await installManagedOpenCode(deps.dataDir);
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", { message: "OpenCode could not be installed." });
        }
        return { installed: true as const };
      }),
      registry: authed.engines.registry.handler(async () => {
        try {
          return await acpRegistry();
        } catch {
          throw new ORPCError("SERVICE_UNAVAILABLE", { message: "ACP registry unavailable." });
        }
      }),
    },
    tasks: {
      overview: authed.tasks.overview.handler(async ({ context }) => {
        const rows = await deps.prisma.task.findMany({ where: { userId: context.actor.userId, spaceId: context.actor.spaceId,
          delegationState: { not: null }, bot: { archivedAt: null } }, orderBy: { updatedAt: "desc" }, take: 50,
          select: { id: true, botId: true, threadId: true, delegationState: true, updatedAt: true,
            bot: { select: { name: true, notifyOnFinish: true } }, thread: { select: { taskBotId: true, groupId: true } },
            runs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true } } } });
        return rows.map(row => ({ taskId: row.id, runId: row.runs[0]?.id ?? null, botId: row.botId, name: row.bot.name,
          threadId: row.threadId, status: row.delegationState === "paused" || row.delegationState === "waiting" ? row.delegationState : row.runs[0]?.status ?? row.delegationState!,
          notify: row.bot.notifyOnFinish, updatedAt: row.updatedAt.toISOString(),
          ...(row.thread.groupId ? { groupId: row.thread.groupId } : row.thread.taskBotId === row.botId ? { taskThreadId: row.threadId } : {}) }));
      }),
      concurrency: authed.tasks.concurrency.handler(async ({ context, input }) => {
        const where = { id: input.botId, userId: context.actor.userId, spaceId: context.actor.spaceId, archivedAt: null };
        const bot = await deps.prisma.bot.findFirst({ where, select: { agentEngine: true, taskConcurrency: true } });
        if (!bot) throw new IsolationError();
        if (input.limit !== undefined) await deps.prisma.bot.updateMany({ where, data: { taskConcurrency: input.limit } });
        const limit = input.limit ?? bot.taskConcurrency;
        return { limit, effectiveLimit: bot.agentEngine === "pi" ? limit : 1 };
      }),
      work: authed.tasks.work.handler(({context,input})=>workStatus(deps.prisma,{...context.actor,taskId:input.taskId})),
      controlWork: authed.tasks.controlWork.handler(async({context,input})=>{
        const result=await controlWorkTree(deps.prisma,context.actor,input);
        // Prompt teardown is a best-effort kick. The persistent outbox and worker own
        // completion, so an HTTP response or API restart cannot certify/lose Stop.
        void reconcileWorkStops(deps,context.actor).catch(()=>undefined);
        return {...result,stopping:result.paused};
      }),
      waits: authed.tasks.waits.handler(async ({ context, input }) => {
        const actor = context.actor;
        // The conversation must be this Mico's main chat or one of its own side conversations.
        const thread = await deps.prisma.thread.findFirst({ where: { id: input.threadId, spaceId: actor.spaceId, userId: actor.userId,
          OR: [{ botId: input.botId }, { taskBotId: input.botId }] }, select: { id: true } });
        if (!thread) throw new IsolationError();
        const waits = await listEventWaits(deps.prisma, { spaceId: actor.spaceId, userId: actor.userId, botId: input.botId }, { threadIds: [thread.id] });
        return waits.map(({ closedAt: _closedAt, closedBy: _closedBy, thread: _thread, ...wait }) => wait);
      }),
      awaitingReplies: authed.tasks.awaitingReplies.handler(async ({ context, input }) => {
        const { spaceId, userId } = context.actor;
        // Answers always land in the Mico's main chat, so the list belongs there.
        const bot = await deps.prisma.bot.findFirst({ where: { id: input.botId, spaceId, userId, archivedAt: null },
          select: { thread: { select: { id: true } } } });
        if (!bot?.thread) throw new IsolationError();
        return awaitingRepliesForThread(deps.prisma, { spaceId, userId, botId: input.botId, threadId: bot.thread.id });
      }),
      stopAwaitingReply: authed.tasks.stopAwaitingReply.handler(async ({ context, input }) => {
        const pending = await awaitingReplyRun(deps.prisma, context.actor, input);
        // Already answered, failed or stopped: nothing is left to stop.
        if (!pending) return { ok: true as const };
        // The person's own Stop on that turn: same cancellation, teardown and settlement.
        const target = await resolveThreadTarget(deps.prisma, context.actor,
          pending.groupId ? { groupId: pending.groupId } : { botId: input.botId });
        if (target.threadId !== pending.threadId) throw new IsolationError();
        await stopThreadRuns(deps, context.actor, target, [pending.runId]);
        return { ok: true as const };
      }),
      hideAwaitingReplies: authed.tasks.hideAwaitingReplies.handler(async ({ context, input }) => {
        await hideAwaitingReplies(deps.prisma, context.actor, input.requestIds);
        return { ok: true as const };
      }),
      cancelWait: authed.tasks.cancelWait.handler(async ({ context, input }) => {
        const { spaceId, userId } = context.actor;
        const result = await closeEventWait(deps.prisma, { spaceId, userId }, { waitId: input.waitId, by: "person" });
        // The teardown outbox finishes the cancellation; this only starts it sooner.
        if (result.cancelled) void reconcileWorkStops(deps, context.actor).catch(() => undefined);
        return { waitId: result.waitId, closed: result.closed, alreadyClosed: result.alreadyClosed, status: result.status };
      }),
      get: authed.tasks.get.handler(({ context, input }) =>
        createTaskControls(deps).get(context.actor, input.runId),
      ),
      control: authed.tasks.control.handler(({ context, input }) =>
        createTaskControls(deps).control(context.actor, input),
      ),
    },
  };
}
