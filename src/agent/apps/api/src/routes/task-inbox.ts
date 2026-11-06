import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { runContinueJob } from "@rakazo/adapter-kit";
import type { Actor, InboxTask } from "@rakazo/contracts";
import { ACTIVE_RUN_STATUSES, MODEL_REQUIRED_SEND_ERROR } from "@rakazo/core";
import { AnswerTooLongError, IsolationError } from "@rakazo/db";
import { assertTeachingSendAllowed } from "../taught-skills.js";
import { loadMessagePage } from "../thread-message-pages.js";
import {
  resolveThreadTarget,
  sendThreadMessage,
  stopThreadRuns,
  threadSnapshot,
} from "../thread-target.js";
import { mapBotSecretInputError } from "./bots.js";
import { releaseComputerControl } from "./computer.js";
import type { RouterContext } from "./context.js";
import { admitMicoTaskComputer } from "../mico-task-computer.js";
import { stopWorkForThread } from "../work-controls.js";
import { modelSetup } from "./shared.js";

type Row = {
  id: string;
  botId: string;
  threadId: string;
  title: string;
  readSeq: number;
  archivedAt: Date | null;
  createdAt: Date;
  clientNonce: string;
};
export function taskInboxRoutes({ deps, repos, authed }: RouterContext) {
  async function owned(actor: Actor, id: string) {
    const row = (
      await deps.prisma.$queryRaw<
        Row[]
      >`SELECT * FROM task_inbox WHERE id=${id} AND "spaceId"=${actor.spaceId} AND "userId"=${actor.userId}`
    )[0];
    if (!row) throw new IsolationError();
    return row;
  }
  async function targetFor(actor: Actor, row: Row) {
    const target = await resolveThreadTarget(deps.prisma, actor, { botId: row.botId, taskThreadId: row.threadId });
    if (target.kind !== "bot") throw new IsolationError();
    return target;
  }
  async function dto(
    row: Row,
    known?: {
      run: { id: string; status: string; error: string | null; updatedAt: Date } | null;
      message: { seq: number } | null;
      event: { payload: unknown } | null;
    },
  ): Promise<InboxTask> {
    const [run, message, event] = known
      ? [known.run, known.message, known.event]
      : await Promise.all([
          deps.prisma.run.findFirst({
            where: { threadId: row.threadId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, status: true, error: true, updatedAt: true },
          }),
          deps.prisma.message.findFirst({
            where: { threadId: row.threadId, role: "bot" },
            orderBy: { seq: "desc" },
            select: { seq: true },
          }),
          deps.prisma.event.findFirst({
            where: { threadId: row.threadId, type: "thread.progress" },
            orderBy: { seq: "desc" },
            select: { payload: true },
          }),
        ]);
    const progress =
      event?.payload &&
      typeof event.payload === "object" &&
      !Array.isArray(event.payload) &&
      "text" in event.payload &&
      typeof event.payload.text === "string"
        ? event.payload.text.slice(0, 120)
        : null;
    return {
      id: row.id,
      botId: row.botId,
      threadId: row.threadId,
      title: row.title,
      runId: run?.id ?? null,
      status: (run?.status as InboxTask["status"]) ?? null,
      error: run?.error ?? null,
      progress,
      unread: Boolean(message && message.seq > row.readSeq),
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: (run?.updatedAt ?? row.createdAt).toISOString(),
    };
  }
  async function send(
    actor: Actor,
    row: Row,
    input: { text: string; clientNonce: string; artifactIds?: string[] },
    locale?: string,
  ) {
    if (row.archivedAt)
      throw new ORPCError("CONFLICT", { message: "Restore the task before sending a message." });
    const target = await targetFor(actor, row);
    await admitMicoTaskComputer(deps.sandbox, actor, target);
    await assertTeachingSendAllowed(deps.prisma, actor.spaceId, row.botId);
    if (
      (!target.bot.agentEngine || target.bot.agentEngine === "pi") &&
      (await modelSetup(deps, actor)).needsModel
    )
      throw new ORPCError("BAD_REQUEST", { message: MODEL_REQUIRED_SEND_ERROR });
    return sendThreadMessage(deps, actor, target, { ...input, responseLocale: locale },
      runId => releaseComputerControl(deps, actor, row.botId, "done", runId),
      async tx => {
        // Use the archive action's exact lock inside the send transaction.
        await tx.$queryRaw`SELECT id FROM threads WHERE id=${row.threadId} FOR UPDATE`;
        const current = await tx.inboxTask.findFirst({ where: { id: row.id, threadId: row.threadId, userId: actor.userId, spaceId: actor.spaceId } });
        if (!current) throw new IsolationError();
        if (current.archivedAt) throw new ORPCError("CONFLICT", { message: "Restore the task before sending a message." });
      },
    );
  }
  return {
    taskInbox: {
      available: authed.taskInbox.available.handler(async () => {
        await deps.prisma.$queryRaw`SELECT id FROM task_inbox LIMIT 0`;
        await deps.prisma.$queryRaw`SELECT "taskBotId" FROM threads LIMIT 0`;
        return { enabled: true as const };
      }),
      list: authed.taskInbox.list.handler(async ({ context }) => {
        const rows = await deps.prisma.inboxTask.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            bot: { archivedAt: null },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          include: {
            thread: {
              select: {
                runs: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  take: 1,
                  select: { id: true, status: true, error: true, updatedAt: true },
                },
                messages: {
                  where: { role: "bot" },
                  orderBy: { seq: "desc" },
                  take: 1,
                  select: { seq: true },
                },
                events: {
                  where: { type: "thread.progress" },
                  orderBy: { seq: "desc" },
                  take: 1,
                  select: { payload: true },
                },
              },
            },
          },
        });
        // An interrupted initial send is not a claimed queued task. It remains recoverable by its nonce.
        const items = await Promise.all(
          rows.map((row) =>
            dto(row, {
              run: row.thread.runs[0] ?? null,
              message: row.thread.messages[0] ?? null,
              event: row.thread.events[0] ?? null,
            }),
          ),
        );
        return items.filter((item) => item.runId !== null);
      }),
      start: authed.taskInbox.start.handler(async ({ context, input }) => {
        await repos.getBot(context.actor, input.botId);
        let row = (
          await deps.prisma.$queryRaw<
            Row[]
          >`SELECT * FROM task_inbox WHERE "spaceId"=${context.actor.spaceId} AND "userId"=${context.actor.userId} AND "clientNonce"=${input.clientNonce}`
        )[0];
        if (row && row.botId !== input.botId)
          throw new ORPCError("CONFLICT", {
            message: "This request already belongs to another Mico.",
          });
        if (!row)
          row = await deps.prisma.$transaction(async (tx) => {
            // Serialize identical starts before creating an isolated thread.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.actor.spaceId}:${context.actor.userId}:${input.clientNonce}`},0))::text AS "lock"`;
            const prior = (
              await tx.$queryRaw<
                Row[]
              >`SELECT * FROM task_inbox WHERE "spaceId"=${context.actor.spaceId} AND "userId"=${context.actor.userId} AND "clientNonce"=${input.clientNonce}`
            )[0];
            if (prior) {
              if (prior.botId !== input.botId) throw new ORPCError("CONFLICT");
              return prior;
            }
            const thread = await tx.thread.create({
              data: {
                spaceId: context.actor.spaceId,
                userId: context.actor.userId,
                taskBotId: input.botId,
                projectKey: `mico:${input.botId}`,
                taskKey: `mico-task:${input.botId}:inbox:${input.clientNonce}`,
                title: input.text.replace(/\s+/g, " ").slice(0, 160),
              },
            });
            return (
              await tx.$queryRaw<
                Row[]
              >`INSERT INTO task_inbox (id,"spaceId","userId","botId","threadId","clientNonce",title) VALUES (${randomUUID()},${context.actor.spaceId},${context.actor.userId},${input.botId},${thread.id},${input.clientNonce},${input.text.replace(/\s+/g, " ").slice(0, 160)}) RETURNING *`
            )[0]!;
          });
        await send(
          context.actor,
          row,
          input,
          context.requestHeaders?.get("x-mycellios-ui-locale") ?? undefined,
        );
        return dto(row);
      }),
      messages: authed.taskInbox.messages.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        await targetFor(context.actor, row);
        return loadMessagePage(deps.prisma, row.threadId, input.before, 100);
      }),
      read: authed.taskInbox.read.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        return {
          item: await dto(row),
          thread: await threadSnapshot(deps, await targetFor(context.actor, row)),
        };
      }),
      send: authed.taskInbox.send.handler(async ({ context, input }) => {
        await send(
          context.actor,
          await owned(context.actor, input.id),
          input,
          context.requestHeaders?.get("x-mycellios-ui-locale") ?? undefined,
        );
        return { ok: true as const };
      }),
      markRead: authed.taskInbox.markRead.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        await deps.prisma
          .$executeRaw`UPDATE task_inbox SET "readSeq"=GREATEST("readSeq",LEAST(${input.seq},(SELECT "nextMessageSeq"-1 FROM threads WHERE id=${row.threadId}))) WHERE id=${row.id} AND "spaceId"=${context.actor.spaceId} AND "userId"=${context.actor.userId}`;
        return { ok: true as const };
      }),
      archive: authed.taskInbox.archive.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        await deps.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM threads WHERE id=${row.threadId} FOR UPDATE`;
          if (
            input.archived &&
            (await tx.run.count({
              where: { threadId: row.threadId, status: { in: [...ACTIVE_RUN_STATUSES] } },
            }))
          )
            throw new ORPCError("CONFLICT", { message: "Stop the task before archiving it." });
          await tx.$executeRaw`UPDATE task_inbox SET "archivedAt"=${input.archived ? new Date() : null} WHERE id=${row.id} AND "spaceId"=${context.actor.spaceId} AND "userId"=${context.actor.userId}`;
        });
        return { ok: true as const };
      }),
      stop: authed.taskInbox.stop.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        await stopThreadRuns(deps, context.actor, await targetFor(context.actor, row));
        await stopWorkForThread(deps, context.actor, row.threadId);
        return { ok: true as const };
      }),
      answer: authed.taskInbox.answer.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        await targetFor(context.actor, row);
        const answered = await deps.events
          .answerRunInput({
            spaceId: context.actor.spaceId,
            threadId: row.threadId,
            runId: input.runId,
            messageId: input.messageId,
            answeredByUserId: context.actor.userId,
            answer: input.answer,
            username: input.username,
            dismiss: input.dismiss,
          })
          .catch((error) => {
            if (error instanceof AnswerTooLongError)
              throw new ORPCError("BAD_REQUEST", { message: error.message });
            throw mapBotSecretInputError(error);
          });
        if (!answered)
          throw new ORPCError("CONFLICT", {
            message: "This prompt is no longer awaiting an answer",
          });
        await deps.jobs.enqueue(runContinueJob(input.runId)).catch(() => undefined);
        return { ok: true as const };
      }),
    },
  };
}
