import { ORPCError } from "@orpc/server";
import { createRepos, isOwnedRoutineThread } from "@rakazo/db";
import { isMicoTaskThread, nativeWorkProjectSession } from "@rakazo/core";
import type { RouterContext } from "./context.js";

/** Metadata never grants filesystem access. Every query retains both ownership fences. */
export function projectRoutes({ deps, authed }: RouterContext) {
  return {
    primaryRun: authed.development.primaryRun.handler(async ({ context, input }) => {
      const run = await deps.prisma.run.findFirst({ where: { id: input.runId, botId: input.botId,
        userId: context.actor.userId, spaceId: context.actor.spaceId }, select: {
          thread: { select: { id: true, taskBotId: true, taskKey: true, projectKey: true } }, task: { select: { delegationState: true } },
        } });
      return Boolean(run && (await isOwnedRoutineThread(deps.prisma, context.actor, run.thread) ||
        !nativeWorkProjectSession(run.thread, run.task ?? {})));
    }),
    projects: authed.development.projects.handler(async ({ context }) => {
      const scope = { userId: context.actor.userId, spaceId: context.actor.spaceId };
      const projects = await deps.prisma.developmentProject.findMany({ where: scope, orderBy: { createdAt: "asc" }, take: 100 });
      if (!projects.length) return [];
      const threads = await deps.prisma.thread.findMany({
        where: { ...scope, projectKey: { in: projects.map(p => `project:${p.id}`) }, taskBot: { archivedAt: null } },
        orderBy: { createdAt: "desc" }, take: 1000,
        select: { id: true, taskBotId: true, projectKey: true, title: true, unread: true },
      });
      return projects.map(p => ({ id: p.id, name: p.name, conversations: threads.filter(t => t.projectKey === `project:${p.id}`)
        .map(t => ({ threadId: t.id, botId: t.taskBotId!, title: t.title ?? "", unread: t.unread })) }));
    }),
    saveProject: authed.development.saveProject.handler(async ({ context, input }) => {
      const scope = { userId: context.actor.userId, spaceId: context.actor.spaceId };
      const row = await deps.prisma.developmentProject.findFirst({ where: { id: input.id, ...scope } });
      if (row) {
        await deps.prisma.developmentProject.updateMany({ where: { id: row.id, ...scope }, data: { name: input.name } });
      } else {
        if (await deps.prisma.developmentProject.count({ where: scope }) >= 100) throw new ORPCError("CONFLICT", { message: "The project limit has been reached." });
        // A foreign UUID cannot be adopted through an upsert, even during a race.
        try { await deps.prisma.developmentProject.create({ data: { ...scope, id: input.id, name: input.name } }); }
        catch (error) {
          const owned = await deps.prisma.developmentProject.findFirst({ where: { id: input.id, ...scope } });
          if (!owned || owned.name !== input.name) throw error;
        }
      }
      return { id: input.id };
    }),
    projectTask: authed.development.projectTask.handler(async ({ context, input }) => {
      const scope = { userId: context.actor.userId, spaceId: context.actor.spaceId };
      await createRepos(deps.prisma).getBot(context.actor, input.botId);
      const thread = await deps.prisma.thread.findFirst({ where: { ...scope, id: input.taskThreadId, taskBotId: input.botId } });
      if (!thread) throw new ORPCError("NOT_FOUND");
      if (!thread.projectKey?.startsWith("project:")) {
        if (isMicoTaskThread(thread) || await isOwnedRoutineThread(deps.prisma, context.actor, thread)) return null;
        throw new ORPCError("CONFLICT", { message: "Reconnect this legacy project before continuing." });
      }
      const project = await deps.prisma.developmentProject.findFirst({ where: { ...scope, id: thread.projectKey.slice(8) } });
      if (!project) throw new ORPCError("NOT_FOUND");
      return { projectId: project.id, name: project.name, ...scope };
    }),
  };
}
