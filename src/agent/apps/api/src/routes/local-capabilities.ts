import { discoverNativeEngines, nativeHostAccess } from "@rakazo/adapters";
import { createTaskControls } from "../task-controls.js";
import { controlWorkTree, workStatus, IsolationError } from "@rakazo/db";
import { reconcileWorkStops } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";

export function localCapabilityRoutes({ authed, deps }: RouterContext) {
  return {
    engines: {
      list: authed.engines.list.handler(async ({ context }) =>
        (await nativeHostAccess(deps.dataDir, context.actor))
          ? discoverNativeEngines(deps.dataDir)
          : [{ id: "pi" as const, name: "Pi", available: true }],
      ),
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
      get: authed.tasks.get.handler(({ context, input }) =>
        createTaskControls(deps).get(context.actor, input.runId),
      ),
      control: authed.tasks.control.handler(({ context, input }) =>
        createTaskControls(deps).control(context.actor, input),
      ),
    },
  };
}
