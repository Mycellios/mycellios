import { runContinueJob } from "@mycellios/adapter-kit";
import type { MessageBlock } from "@mycellios/contracts";
import {
  addressedGroupBotIds,
  BOT_MESSAGE_MAX_LENGTH,
  botMessageHopExhausted,
  buildBotMessageWakePrompt,
  clampBotMessage,
  groupLeadBotId,
  nextBotMessageHop,
  stuckWorkStatusMessages,
  taskAnswerText,
} from "@mycellios/core";
import {
  addBotMessageRecipientsInTransaction,
  appendEventInTransaction,
  createBotMessageRequestInTransaction,
  createThreadMessageInTransaction,
  findAbandonedRecipientRunIds,
  IsolationError,
  lockOwnedGroup,
  lockRequestOfRecipientRun,
  markRequestSettledInTransaction,
  type Prisma,
  type PrismaClient,
  releaseBotMessageRequestInTransaction,
  settleOrphanRecipientInTransaction,
  settleRecipientInTransaction,
  settleStoppedRecipientsInTransaction,
  touchGroupUpdatedAt,
  withTransactionRetry,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import { loadBotMessageContext } from "./bot-messages.js";
import type { ExecutorDeps } from "./executor.js";

type Deps = Pick<ExecutorDeps, "prisma" | "events" | "jobs">;
type SourceRun = {
  id: string;
  spaceId: string;
  threadId: string;
  botId: string;
  userId: string;
  sourceMessageId?: string | null;
};

/**
 * send_to_group: a Mico starts work in one of its groups from its own chat. The brief goes to
 * the members it names, else to the group's lead; each answers in the group, and every answer
 * comes back to the Mico's main chat (together, when several members work on it).
 */
export async function sendToGroup(
  deps: Deps,
  run: SourceRun,
  sender: { id: string; name: string },
  input: { group_id: string; message: string; bot_ids?: readonly string[]; deliveryKey?: string },
) {
  const text = input.message.trim();
  if (!text || text.length > BOT_MESSAGE_MAX_LENGTH) {
    return { error: `message must contain 1 to ${BOT_MESSAGE_MAX_LENGTH} characters` } as const;
  }
  const groupId = input.group_id.trim();
  if (!groupId) return { error: "group_id is required" } as const;
  const sourceContext = await loadBotMessageContext(deps.prisma, run.sourceMessageId);
  const hop = nextBotMessageHop(sourceContext?.hop);
  if (botMessageHopExhausted(hop)) {
    return {
      error:
        "bot-to-bot message limit reached for this chain; report back to the user instead of starting group work",
    } as const;
  }
  const key = `group-request:${input.deliveryKey ?? run.id}`;
  const committed = await withTransactionRetry(() =>
    deps.prisma.$transaction(async (tx) => {
      try {
        await lockOwnedGroup(tx, run, groupId);
      } catch (error) {
        if (error instanceof IsolationError)
          return { error: "group is no longer available" } as const;
        throw error;
      }
      const group = await tx.chatGroup.findFirst({
        where: { id: groupId, spaceId: run.spaceId, userId: run.userId, archivedAt: null },
        select: {
          name: true,
          leadBotId: true,
          thread: { select: { id: true } },
          members: {
            where: { bot: { archivedAt: null } },
            select: { bot: { select: { id: true, name: true } } },
            orderBy: [{ createdAt: "asc" }, { botId: "asc" }],
          },
        },
      });
      if (!group?.thread) return { error: "group is no longer available" } as const;
      const members = group.members.map((member) => member.bot);
      if (!members.some((member) => member.id === sender.id)) {
        return { error: "you can only send work to a group you belong to" } as const;
      }
      const groupThreadId = group.thread.id;
      if (groupThreadId === run.threadId) {
        return {
          error: "you are already in this group; reply here or use handoff_to_bot",
        } as const;
      }
      const owner = await tx.bot.findFirst({
        where: { id: sender.id, spaceId: run.spaceId, userId: run.userId },
        select: { thread: { select: { id: true } } },
      });
      const senderMainThreadId = owner?.thread?.id ?? run.threadId;
      for (const threadId of [
        ...new Set([run.threadId, groupThreadId, senderMainThreadId]),
      ].sort()) {
        await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
      }
      const replay = await tx.message.findFirst({
        where: { threadId: groupThreadId, clientNonce: { startsWith: `${key}:` } },
        select: { id: true },
      });
      if (replay) return { replayed: true as const, groupName: group.name };
      const active = await tx.run.findFirst({
        where: {
          id: run.id,
          spaceId: run.spaceId,
          userId: run.userId,
          botId: run.botId,
          status: "running",
        },
        select: { id: true },
      });
      if (!active) return { error: "source run is no longer active" } as const;

      const others = members.filter((member) => member.id !== sender.id);
      const memberIds = new Set(others.map((member) => member.id));
      const explicit = [
        ...new Set((input.bot_ids ?? []).map((id) => String(id).trim()).filter(Boolean)),
      ];
      const unknown = explicit.find((id) => !memberIds.has(id));
      if (unknown) return { error: "every bot_id must be another member of that group" } as const;
      let targetIds = explicit.length ? explicit : addressedGroupBotIds({ text, members: others });
      if (!targetIds.length) {
        const lead = groupLeadBotId(members, group.leadBotId);
        const fallback = lead && lead !== sender.id ? lead : others[0]?.id;
        targetIds = fallback ? [fallback] : [];
      }
      if (!targetIds.length)
        return { error: "that group has no other member to take the work" } as const;
      const targets = targetIds.map((id) => others.find((member) => member.id === id)!);

      const notices: Array<{ threadId: string; seq: number }> = [];
      const runIds: string[] = [];
      for (const target of targets) {
        const handoff: MessageBlock = {
          kind: "handoff",
          fromBotId: sender.id,
          toBotId: target.id,
          text,
          hop,
        };
        const message = await createThreadMessageInTransaction(tx, {
          threadId: groupThreadId,
          role: "bot",
          blocks: [handoff],
          botId: sender.id,
          clientNonce: `${key}:${target.id}`,
        });
        const task = await tx.task.create({
          data: {
            spaceId: run.spaceId,
            botId: target.id,
            threadId: groupThreadId,
            userId: run.userId,
            prompt: text,
            status: "queued",
          },
        });
        const queued = await tx.run.create({
          data: {
            spaceId: run.spaceId,
            botId: target.id,
            threadId: groupThreadId,
            taskId: task.id,
            userId: run.userId,
            status: "queued",
            trigger: "follow_up",
            sourceMessageId: message.id,
          },
          select: { id: true },
        });
        runIds.push(queued.id);
        const event = await appendEventInTransaction(tx, {
          spaceId: run.spaceId,
          threadId: groupThreadId,
          botId: sender.id,
          type: "group.handoff",
          payload: { messageId: message.id, fromBotId: sender.id, toBotId: target.id, text },
        });
        notices.push({ threadId: groupThreadId, seq: event.seq });
      }
      const requestId = await createBotMessageRequestInTransaction(tx, {
        spaceId: run.spaceId,
        userId: run.userId,
        senderBotId: sender.id,
        senderThreadId: senderMainThreadId,
        senderRunId: run.id,
        groupId,
      });
      await addBotMessageRecipientsInTransaction(
        tx,
        run,
        requestId,
        targets.map((target, index) => ({ botId: target.id, runId: runIds[index]! })),
      );
      // The sender's own chat shows what it sent and to whom.
      const receipt: MessageBlock = {
        kind: "bot_message_sent",
        toBotId: targets[0]!.id,
        toBotName: targets[0]!.name,
        text,
        intent: "request",
        ...(targets.length > 1
          ? { recipients: targets.map((target) => ({ botId: target.id, botName: target.name })) }
          : {}),
      };
      const echo = await createThreadMessageInTransaction(tx, {
        threadId: run.threadId,
        role: "bot",
        blocks: [receipt],
        botId: sender.id,
        runId: run.id,
      });
      const echoEvent = await appendEventInTransaction(tx, {
        spaceId: run.spaceId,
        threadId: run.threadId,
        botId: sender.id,
        type: "thread.message.created",
        runId: run.id,
        payload: { messageId: echo.id, role: "bot", blocks: [receipt] },
      });
      notices.push({ threadId: run.threadId, seq: echoEvent.seq });
      await touchGroupUpdatedAt(tx, groupId);
      return {
        ok: true as const,
        groupName: group.name,
        requestId,
        runIds,
        notices,
        members: targets.map((target) => ({ botId: target.id, name: target.name })),
      };
    }),
  );
  if ("error" in committed) return committed;
  if ("replayed" in committed) {
    return {
      ok: true,
      replayed: true,
      groupId,
      groupName: committed.groupName,
      note: "Already sent to that group in this turn; it was not sent again.",
    };
  }
  for (const notice of committed.notices) {
    await deps.events.notify(notice.threadId, notice.seq).catch((error) => {
      getLogger().error("group request realtime notification", error);
    });
  }
  for (const runId of committed.runIds) {
    await deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
      // The queued run is durable and the job reconciler repairs a missed wake.
      getLogger().error("group request enqueue", error);
    });
  }
  return {
    ok: true,
    groupId,
    groupName: committed.groupName,
    members: committed.members,
    note: `Sent to ${committed.members.map((member) => member.name).join(", ")} in ${committed.groupName}. They work in the group; their answers come back to your main chat${committed.members.length > 1 ? " together, once all have answered or been stopped" : ""}. End this turn when nothing else is left to do; do not poll.`,
  };
}

async function runAnswer(
  prisma: PrismaClient | Prisma.TransactionClient,
  run: { id: string; threadId: string },
): Promise<string> {
  const messages = await prisma.message.findMany({
    where: { threadId: run.threadId, runId: run.id, role: "bot" },
    orderBy: { seq: "desc" },
    take: 20,
    select: { blocks: true },
  });
  for (const message of messages) {
    const text = taskAnswerText(
      Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : [],
    );
    if (text) return text;
  }
  return "";
}

/**
 * A member's turn for a send_to_group request ended: its answer (or what went wrong) goes to
 * the sender's main chat. A stopped turn settles without an answer. Safe to call more than
 * once: a settled recipient is left alone.
 */
export async function settleGroupRequestRun(deps: Deps, runId: string): Promise<void> {
  const committed = await withTransactionRetry(() =>
    deps.prisma.$transaction(async (tx) => {
      const locked = await lockRequestOfRecipientRun(tx, runId);
      if (!locked || locked.request.settledAt || !locked.request.groupId) return null;
      const recipient = locked.request.recipients.find((row) => row.id === locked.recipientId);
      if (recipient?.state !== "asked") return null;
      const run = await tx.run.findUnique({
        where: { id: runId },
        select: { id: true, threadId: true, status: true, error: true },
      });
      if (!run || !["completed", "failed", "cancelled"].includes(run.status)) return null;
      const stuck =
        run.status === "cancelled" && stuckWorkStatusMessages().includes(run.error ?? "");
      if (run.status === "cancelled" && !stuck) {
        const resumeRunIds = await settleStoppedRecipientsInTransaction(tx, [runId]);
        return { runIds: resumeRunIds, notices: [] as Array<{ threadId: string; seq: number }> };
      }
      const failed = run.status !== "completed";
      const answer = failed ? "" : await runAnswer(tx, run);
      const text = clampBotMessage(
        failed
          ? `Could not complete the group request: ${run.error ?? "unknown error"}`
          : answer || "The member finished its turn without a written answer.",
      );
      const group = await tx.chatGroup.findUnique({
        where: { id: locked.request.groupId },
        select: { name: true },
      });
      const block: MessageBlock = {
        kind: "bot_message_received",
        fromBotId: recipient.botId,
        fromBotName: recipient.bot.name,
        text,
        intent: failed ? "status" : "result",
      };
      const inbound = await createThreadMessageInTransaction(tx, {
        threadId: locked.request.senderThreadId,
        role: "user",
        blocks: [block],
        clientNonce: `group-answer:${runId}`,
        markUnread: failed,
      });
      const { remaining } = await settleRecipientInTransaction(
        tx,
        locked.request,
        recipient.id,
        failed ? "failed" : "replied",
        inbound.id,
      );
      let resumeRunId: string | null = null;
      if (locked.request.recipients.length > 1) {
        if (remaining === 0) {
          resumeRunId = (
            await releaseBotMessageRequestInTransaction(tx, locked.request, group?.name)
          ).runId;
        }
      } else {
        const task = await tx.task.create({
          data: {
            spaceId: locked.request.spaceId,
            botId: locked.request.senderBotId,
            threadId: locked.request.senderThreadId,
            userId: locked.request.userId,
            prompt: buildBotMessageWakePrompt({
              from: { id: recipient.botId, name: recipient.bot.name },
              text,
              intent: failed ? "status" : "result",
            }),
            status: "queued",
          },
        });
        const resume = await tx.run.create({
          data: {
            spaceId: locked.request.spaceId,
            botId: locked.request.senderBotId,
            threadId: locked.request.senderThreadId,
            taskId: task.id,
            userId: locked.request.userId,
            status: "queued",
            trigger: "bot_message",
            sourceMessageId: inbound.id,
          },
          select: { id: true },
        });
        await tx.message.update({ where: { id: inbound.id }, data: { runId: resume.id } });
        await markRequestSettledInTransaction(tx, locked.request.id, resume.id);
        resumeRunId = resume.id;
      }
      const event = await appendEventInTransaction(tx, {
        spaceId: locked.request.spaceId,
        threadId: locked.request.senderThreadId,
        botId: locked.request.senderBotId,
        type: "thread.message.created",
        runId: resumeRunId ?? undefined,
        payload: { messageId: inbound.id, role: "user", blocks: [block] },
      });
      return {
        runIds: resumeRunId ? [resumeRunId] : [],
        notices: [{ threadId: locked.request.senderThreadId, seq: event.seq }],
      };
    }),
  );
  if (!committed) return;
  for (const notice of committed.notices) {
    await deps.events.notify(notice.threadId, notice.seq).catch((error) => {
      getLogger().error("group answer realtime notification", error);
    });
  }
  for (const id of committed.runIds) {
    await deps.jobs.enqueue(runContinueJob(id)).catch((error) => {
      getLogger().error("group answer enqueue", error);
    });
  }
}

/**
 * Reconciler repair: recipients whose turns ended without passing through the answer or stop
 * paths (a crash, an archive, a deleted conversation) settle now, so no request waits forever.
 */
export async function reconcileBotRequestRecipients(
  deps: Deps,
  options: { limit?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const found = await findAbandonedRecipientRunIds(deps.prisma, {
    stuckErrors: stuckWorkStatusMessages(),
    limit: options.limit ?? 50,
    // Leave the executor a moment to deliver a fresh answer itself.
    olderThan: new Date(now.getTime() - 30_000),
  });
  const resumeRunIds: string[] = [];
  if (found.stoppedRunIds.length) {
    resumeRunIds.push(
      ...(await withTransactionRetry(() =>
        deps.prisma.$transaction((tx) =>
          settleStoppedRecipientsInTransaction(tx, found.stoppedRunIds),
        ),
      )),
    );
  }
  for (const recipientId of found.orphanRecipientIds) {
    resumeRunIds.push(
      ...(await withTransactionRetry(() =>
        deps.prisma.$transaction((tx) => settleOrphanRecipientInTransaction(tx, recipientId)),
      )),
    );
  }
  for (const runId of found.groupRunIds) {
    await settleGroupRequestRun(deps, runId).catch((error) =>
      getLogger().error("group answer reconciliation", error),
    );
  }
  for (const runId of resumeRunIds) {
    await deps.jobs.enqueue(runContinueJob(runId)).catch((error) => {
      getLogger().error("bot request resume enqueue", error);
    });
  }
}
