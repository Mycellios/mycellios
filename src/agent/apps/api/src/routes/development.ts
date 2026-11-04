import { runFailureError } from "@rakazo/core";
import { ORPCError } from "@orpc/server";
import { createRepos } from "@rakazo/db";
import { resolveThreadTarget } from "../thread-target.js";
import type { RouterContext } from "./context.js";
/** Task conversations reuse the real Mico; primary chat, models and secrets stay untouched. */
export function developmentRoutes(ctx: RouterContext) {
  const { deps, authed } = ctx;
  return {
    development: {
      status: authed.development.status.handler(async ({ context, input }) => {
        const target = await resolveThreadTarget(deps.prisma, context.actor, input);
        const run = await deps.prisma.run.findFirst({
          where: {
            id: input.runId,
            botId: input.botId,
            threadId: target.threadId,
            userId: context.actor.userId,
            spaceId: context.actor.spaceId,
          },
          select: { status: true, error: true },
        });
        if (!run) throw new ORPCError("NOT_FOUND");
        const rows = await deps.prisma.message.findMany({
          where: { threadId: target.threadId, runId: input.runId, role: "bot" },
          orderBy: { seq: "asc" },
          take: 100,
        });
        const detail = rows
          .flatMap((row) =>
            (Array.isArray(row.blocks) ? row.blocks : []).flatMap((block) =>
              typeof block === "object" &&
              block !== null &&
              "kind" in block &&
              block.kind === "text" &&
              "text" in block &&
              typeof block.text === "string"
                ? [block.text]
                : [],
            ),
          )
          .join("\n\n")
          .slice(-128000);
        return {
          status: run.status,
          error: run.error
            ? runFailureError({ type: "run.failed", payload: { error: run.error } })
            : null,
          detail,
        };
      }),
      open: authed.development.open.handler(async ({ context, input }) => {
        const actor = context.actor;
        await createRepos(deps.prisma).getBot(actor, input.botId);
        const row = await deps.prisma.thread.upsert({
          where: {
            spaceId_userId_taskKey: {
              spaceId: actor.spaceId,
              userId: actor.userId,
              taskKey: input.taskKey,
            },
          },
          create: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            taskBotId: input.botId,
            projectKey: input.projectKey,
            taskKey: input.taskKey,
            title: input.title,
          },
          update: {},
        });
        if (row.taskBotId !== input.botId || row.projectKey !== input.projectKey)
          throw new ORPCError("CONFLICT", {
            message: "This task already belongs to a different Mico or project.",
          });
        return { threadId: row.id };
      }),
      list: authed.development.list.handler(async ({ context, input }) => {
        const actor = context.actor;
        await createRepos(deps.prisma).getBot(actor, input.botId);
        const rows = await deps.prisma.thread.findMany({
          where: {
            spaceId: actor.spaceId,
            userId: actor.userId,
            taskBotId: input.botId,
            ...(input.projectKey ? { projectKey: input.projectKey } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 1000,
        });
        return rows.map((row) => ({
          threadId: row.id,
          projectKey: row.projectKey!,
          taskKey: row.taskKey!,
          title: row.title ?? "",
        }));
      }),
    },
  };
}
