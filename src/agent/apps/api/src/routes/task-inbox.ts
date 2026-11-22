import { randomUUID } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { runContinueJob } from "@mycellios/adapter-kit";
import type { Actor, InboxTask } from "@mycellios/contracts";
import { automaticThreadTitle, MODEL_REQUIRED_SEND_ERROR, THREAD_OUTCOMES } from "@mycellios/core";
import { AnswerTooLongError, IsolationError, reopenSideThreadForSend } from "@mycellios/db";
import { archiveSideThread, restoreSideThread } from "../side-threads.js";
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
import { discoverTaskConversations } from "../task-inbox-conversations.js";

type Row = {
  id: string;
  botId: string;
  threadId: string;
  title: string;
  readSeq: number;
  pinned?: boolean;
  remindAt?: Date | null;
  /** The thread's archive mark; the inbox column is only a mirror kept for older code. */
  archivedAt: Date | null;
  outcome?: string | null;
  lastError?: string | null;
  createdAt: Date;
  clientNonce: string;
};
export function taskInboxRoutes({ deps, repos, authed }: RouterContext) {
  /** Conversations being deleted are hidden from Tasks until they are restored or removed. */
  async function owned(actor: Actor, id: string) {
    const row = (
      await deps.prisma.$queryRaw<
        Row[]
      >`SELECT i.id,i."botId",i."threadId",i.title,i."readSeq",i.pinned,i."remindAt",i."createdAt",i."clientNonce",
          t."archivedAt",t.outcome,t."lastError"
        FROM task_inbox i JOIN threads t ON t.id=i."threadId" AND t."spaceId"=i."spaceId" AND t."userId"=i."userId"
        WHERE i.id=${id} AND i."spaceId"=${actor.spaceId} AND i."userId"=${actor.userId} AND t."deleteAfter" IS NULL`
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
      pinned: row.pinned ?? false,
      remindAt: row.remindAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      outcome: THREAD_OUTCOMES.find((outcome) => outcome === row.outcome) ?? null,
      lastError: row.lastError ?? null,
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
        // Under the archive action's exact lock: writing in an archived conversation brings it
        // back, in this same transaction, with its history and read state.
        await reopenSideThreadForSend(tx, actor, row.threadId);
        const current = await tx.inboxTask.findFirst({ where: { id: row.id, threadId: row.threadId, userId: actor.userId, spaceId: actor.spaceId } });
        if (!current) throw new IsolationError();
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
        await discoverTaskConversations(deps.prisma, context.actor);
        const rows = await deps.prisma.inboxTask.findMany({
          where: {
            spaceId: context.actor.spaceId,
            userId: context.actor.userId,
            bot: { archivedAt: null, spaceId: context.actor.spaceId },
            thread: { userId: context.actor.userId, spaceId: context.actor.spaceId, deleteAfter: null },
          },
          orderBy: [{pinned:"desc"},{createdAt:"desc"}],
          take: 200,
          include: {
            thread: {
              select: {
                title: true,
                lastReadSeq: true,
                archivedAt: true,
                outcome: true,
                lastError: true,
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
            dto({ ...row, title: row.thread.title ?? row.title, readSeq: Math.max(row.readSeq, row.thread.lastReadSeq),
              archivedAt: row.thread.archivedAt, outcome: row.thread.outcome, lastError: row.thread.lastError }, {
              run: row.thread.runs[0] ?? null,
              message: row.thread.messages[0] ?? null,
              event: row.thread.events[0] ?? null,
            }),
          ),
        );
        return items
          .filter((item, index) => item.runId !== null || rows[index]?.clientNonce.startsWith("conversation:"))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
                title: automaticThreadTitle([{ kind: "text", text: input.text }]) ?? input.text.replace(/\s+/g, " ").slice(0, 120),
                titleSource: "auto",
                startedBy: "user",
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
      followUp: authed.taskInbox.followUp.handler(async ({context,input}) => {
        const row = await owned(context.actor,input.id);
        await targetFor(context.actor,row);
        const remindAt = input.remindAt ? new Date(input.remindAt) : null;
        if (remindAt && (remindAt.getTime() <= Date.now() || remindAt.getTime() > Date.now()+366*86400000))
          throw new ORPCError("BAD_REQUEST",{message:"Choose a future reminder within the next year."});
        await deps.prisma.$transaction(async tx => {
          const [thread] = await tx.$queryRaw<Array<{archivedAt:Date|null}>>`SELECT "archivedAt" FROM threads WHERE id=${row.threadId} FOR UPDATE`;
          await tx.inboxTask.findFirstOrThrow({where:{id:row.id,userId:context.actor.userId,spaceId:context.actor.spaceId}});
          if(thread?.archivedAt && (input.pinned===true || remindAt))
            throw new ORPCError("CONFLICT",{message:"Restore the task before setting follow-up."});
          await tx.inboxTask.update({where:{id:row.id},data:{
            ...(input.pinned!==undefined?{pinned:input.pinned}:{}),
            ...(input.remindAt!==undefined?{remindAt,reminderNotifiedAt:null,reminderClaimedAt:null}:{}),
          }});
        });
        return {ok:true as const};
      }),
      archive: authed.taskInbox.archive.handler(async ({ context, input }) => {
        const row = await owned(context.actor, input.id);
        const target = await targetFor(context.actor, row);
        // The same archive as a Mico tab: stop the conversation first, then archive the thread.
        if (input.archived) await archiveSideThread(deps, context.actor, target);
        else await restoreSideThread(deps, context.actor, target);
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
