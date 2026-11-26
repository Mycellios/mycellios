import { ORPCError } from "@orpc/server";
import type { JobPublisher, SandboxProvider } from "@mycellios/adapter-kit";
import { runContinueJob } from "@mycellios/adapter-kit";
import { cancelComputerRunWork, screenLeaseIdForRun, toComputerRef } from "@mycellios/adapters";
import type {
  Actor,
  GroupMember,
  MessageBlock,
  MessageReaction,
  ReplyPreview,
  ThreadSnapshot,
} from "@mycellios/contracts";
import {
  GROUP_MEMBER_MIN,
  MessageBlock as MessageBlockSchema,
  SHARED_MICO_CONVERSATION_ERROR,
} from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  addressedGroupBotIds,
  BACKGROUND_RUN_TRIGGERS,
  callIdFromClientNonce,
  groupContinuePrompt,
  isContinueRequest,
  isConversationalRun,
  isInternalWorkThread,
  isMicoTaskThread,
  messageReaction,
  projectMessages,
  QUEUE_HOLDING_RUN_STATUSES,
  resolveGroupTargetBotIds,
  runFailureError,
} from "@mycellios/core";
import { deriveMessageQuote, messageReplyPreview } from "@mycellios/core/message-quote";
import type { Prisma, PrismaClient, ThreadEvents } from "@mycellios/db";
import {
  answerWaitingRunWithTextInTransaction,
  appendEventInTransaction,
  clearEndedRunState,
  createGroupRepos,
  createRepos,
  createThreadMessageInTransaction,
  expireComputerExecutionLeases,
  IsolationError,
  isOwnedRoutineThread,
  isOwnedWorkflowThread,
  lockOwnedGroup,
  primaryActiveRun,
  queueTaskReportInTransaction,
  recordThreadTurnOutcome,
  retireWaitingQuestionInTransaction,
  settleStoppedRecipientsInTransaction,
  touchGroupUpdatedAt,
} from "@mycellios/db";
import { getLogger } from "@mycellios/logging";
import {
  buildSendPrompt,
  buildUserMessageBlocks,
  resolveGroupSendAttachments,
  resolveSendAttachments,
} from "./artifacts.js";
import { resolveBusyBotName, toComputerStatus } from "./computer-status.js";
import { withResponseLanguage } from "./response-language.js";
import { withSerializableRetry } from "./serializable-retry.js";
import { loadMessagePage } from "./thread-message-pages.js";

export type ThreadTarget =
  | {
      kind: "bot";
      botId: string;
      threadId: string;
      projectSessionId?: string;
      bot: Awaited<ReturnType<ReturnType<typeof createRepos>["getBot"]>>;
      /** A Space member's own conversation with this shared Mico (specs/space-members). */
      memberUserId?: string;
    }
  | {
      kind: "group";
      groupId: string;
      threadId: string;
      groupName: string;
      members: GroupMember[];
      memberBotIds: string[];
    };

const THREAD_MESSAGE_PAGE_SIZE = 100;
const RECENT_THREAD_MESSAGE_PAGE_SIZE = 24;
const RUNS_NEEDING_CONTINUE = new Set(["queued", "waiting_takeover"]);

const STEERABLE_RUN_STATUSES = new Set<string>(QUEUE_HOLDING_RUN_STATUSES);
/** Background work holds pending steering; paused cards never hold the queue. */
function steersUserMessage(run: { status: string; trigger?: string | null }) {
  return STEERABLE_RUN_STATUSES.has(run.status) && isConversationalRun(run.trigger);
}

type MentionTargetInput = string | { kind: "bot" | "group" | "routine" | "connector" | "thread"; id: string };

function splitMentionTargets(mentions: MentionTargetInput[] | undefined) {
  const botMentionIds = new Set<string>();
  const groupMentionIds = new Set<string>();
  const routineMentionIds = new Set<string>();
  const connectorMentionIds = new Set<string>();
  const threadMentionIds = new Set<string>();
  for (const mention of mentions ?? []) {
    if (typeof mention === "string") {
      botMentionIds.add(mention);
      continue;
    }
    if (mention.kind === "bot") botMentionIds.add(mention.id);
    if (mention.kind === "group") groupMentionIds.add(mention.id);
    if (mention.kind === "routine") routineMentionIds.add(mention.id);
    if (mention.kind === "connector") connectorMentionIds.add(mention.id);
    if (mention.kind === "thread") threadMentionIds.add(mention.id);
  }
  return {
    botMentionIds: [...botMentionIds],
    groupMentionIds: [...groupMentionIds],
    routineMentionIds: [...routineMentionIds],
    connectorMentionIds: [...connectorMentionIds],
    threadMentionIds: [...threadMentionIds].slice(0, 8),
  };
}

/**
 * Conversations a message points at: only this person's own, in this Space and of the same
 * Mico, and not being deleted. Others are left out, so a link never reveals or reaches them.
 */
async function resolveThreadLinks(
  tx: Prisma.TransactionClient,
  actor: Actor,
  botId: string,
  threadIds: string[],
): Promise<Array<Extract<MessageBlock, { kind: "thread_link" }>>> {
  if (!threadIds.length) return [];
  const rows = await tx.thread.findMany({
    where: { id: { in: threadIds }, spaceId: actor.spaceId, userId: actor.userId, taskBotId: botId, deleteAfter: null },
    select: { id: true, title: true },
  });
  const titles = new Map(rows.map((row) => [row.id, Array.from(row.title?.trim() ?? "").slice(0, 120).join("")]));
  return threadIds.flatMap((threadId) => titles.has(threadId)
    ? [{ kind: "thread_link" as const, botId, threadId, title: titles.get(threadId) ?? "" }]
    : []);
}

/** Tells the model which of its conversations the person pointed at, by their titles. */
export function threadLinkPrompt(prompt: string, links: ReadonlyArray<{ title: string }>) {
  if (!links.length) return prompt;
  const titles = links.map((link) => `“${link.title || "Untitled conversation"}”`).join(", ");
  const line = `The person points at these conversations of yours: ${titles}.`;
  return prompt ? `${prompt}\n\n${line}` : line;
}

async function resolveOwnedConnectorDisplayNames(
  tx: Prisma.TransactionClient,
  actor: Actor,
  connectionIds: string[],
) {
  if (!connectionIds.length) return [];
  const rows = await tx.connection.findMany({
    where: {
      id: { in: connectionIds },
      spaceId: actor.spaceId,
      userId: actor.userId,
      status: "connected",
    },
    select: { id: true, displayName: true },
  });
  if (rows.length !== connectionIds.length) throw new IsolationError();
  const byId = new Map(rows.map((row) => [row.id, row.displayName]));
  return connectionIds.map((id) => byId.get(id) ?? "connector");
}

function sendRunClientNonce(
  clientNonce: string | undefined,
  messageId: string,
  botId?: string,
): string | undefined {
  if (!clientNonce) return undefined;
  return botId ? `send:${messageId}:${botId}` : `send:${messageId}`;
}

async function enqueueRunsNeedingContinue(
  jobs: JobPublisher,
  runs: Array<{ id: string; status: string }>,
) {
  await Promise.all(
    runs
      .filter((run) => RUNS_NEEDING_CONTINUE.has(run.status))
      .map((run) =>
        jobs.enqueue(runContinueJob(run.id)).catch((error) => {
          // The queued run is durable; the reconciler repairs a missed immediate wake.
          getLogger().error("thread send enqueue", error);
        }),
      ),
  );
}

async function findSendReceipt(prisma: PrismaClient, threadId: string, clientNonce: string) {
  return prisma.message.findUnique({
    where: { threadId_clientNonce: { threadId, clientNonce } },
    include: { sourceRuns: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
}

async function replayExistingSend(
  deps: { prisma: PrismaClient; events: ThreadEvents; jobs: JobPublisher },
  threadId: string,
  clientNonce: string | undefined,
  releaseTakeover?: (runId: string) => Promise<void>,
) {
  if (!clientNonce) return null;
  const message = await findSendReceipt(deps.prisma, threadId, clientNonce);
  if (!message) return null;
  const receiptEvent = await deps.prisma.event.findFirst({
    where: {
      threadId,
      type: "thread.message.created",
      payload: { path: ["messageId"], equals: message.id },
    },
    orderBy: { seq: "desc" },
    select: { payload: true },
  });
  const receiptRunIds = sendEventRunIds(receiptEvent?.payload);
  const receiptRuns = receiptRunIds.length
    ? await deps.prisma.run.findMany({ where: { id: { in: receiptRunIds } } })
    : [];
  const receiptRunById = new Map(receiptRuns.map((run) => [run.id, run]));
  const orderedReceiptRuns = receiptRunIds.flatMap((id) => {
    const run = receiptRunById.get(id);
    return run ? [run] : [];
  });
  const linkedRun =
    message.sourceRuns[0] ??
    (message.runId ? await deps.prisma.run.findUnique({ where: { id: message.runId } }) : null);
  if (!linkedRun && orderedReceiptRuns.length === 0) return null;
  const runs = orderedReceiptRuns.length
    ? orderedReceiptRuns
    : message.sourceRuns.length
      ? message.sourceRuns
      : [linkedRun!];
  const pendingSteering = releaseTakeover
    ? await deps.prisma.steeringMessage.findFirst({
        where: { messageId: message.id, claimedAt: null },
        select: { runId: true },
      })
    : null;
  if (releaseTakeover && pendingSteering?.runId) await releaseTakeover(pendingSteering.runId);
  await enqueueRunsNeedingContinue(deps.jobs, runs);
  const latestEvent = await deps.prisma.event.findFirst({
    where: { threadId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  if (latestEvent) {
    await deps.events.notify(threadId, latestEvent.seq).catch((error) => {
      // Subscribers catch up from the durable event cursor after a missed realtime wake.
      getLogger().error("thread send realtime notification", error);
    });
  }
  return sendResult(message, runs);
}

function sendEventRunIds(payload: Prisma.JsonValue | undefined): string[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const runIds = (payload as { runIds?: unknown }).runIds;
  return Array.isArray(runIds) ? runIds.filter((id): id is string => typeof id === "string") : [];
}

function sendResult(message: { id: string; seq: number }, runs: Array<{ id: string; taskId: string }>) {
  const first = runs[0];
  if (!first) throw new IsolationError("Send did not create a run");
  return {
    taskId: first.taskId,
    runId: first.id,
    seq: message.seq,
    messageId: message.id,
    runIds: runs.map((run) => run.id),
  };
}

export async function cancelSupersededQueuedRuns(
  tx: Prisma.TransactionClient,
  input: { threadId: string; botIds: string[]; keepRunIds: string[] },
) {
  const superseded = await tx.run.findMany({
    where: {
      threadId: input.threadId,
      botId: { in: input.botIds },
      status: "queued",
      OR: [{ trigger: "user", sourceMessage: { role: "user" } }, { trigger: "reaction" }],
      id: { notIn: input.keepRunIds },
    },
    select: { id: true, taskId: true },
  });
  if (superseded.length === 0) return;
  const now = new Date();
  await tx.run.updateMany({
    where: { id: { in: superseded.map((run) => run.id) } },
    data: { status: "cancelled", completedAt: now },
  });
  await clearEndedRunState(
    tx,
    superseded.map((run) => run.id),
  );
  await tx.task.updateMany({
    where: { id: { in: superseded.map((run) => run.taskId) } },
    data: { status: "cancelled" },
  });
}

async function lockAndLoadGroupMembers(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: Extract<ThreadTarget, { kind: "group" }>,
) {
  return (await lockAndLoadGroup(tx, actor, target)).members;
}

/** The group's active members in order, and the lead the person chose (null: first member). */
async function lockAndLoadGroup(
  tx: Prisma.TransactionClient,
  actor: Actor,
  target: Extract<ThreadTarget, { kind: "group" }>,
) {
  await lockOwnedGroup(tx, actor, target.groupId);
  const group = await tx.chatGroup.findFirst({
    where: {
      id: target.groupId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
      thread: { id: target.threadId },
    },
    include: {
      members: {
        where: { bot: { archivedAt: null } },
        include: { bot: { select: { id: true, name: true, color: true } } },
        orderBy: [{ createdAt: "asc" }, { botId: "asc" }],
      },
    },
  });
  if (!group || group.members.length < GROUP_MEMBER_MIN) throw new IsolationError();
  return {
    leadBotId: group.leadBotId ?? null,
    members: group.members.map((member) => ({
      botId: member.bot.id,
      name: member.bot.name,
      color: member.bot.color,
    })),
  };
}

/**
 * A Space member's conversation with a shared Mico stays its owner's thread, but only that
 * member writes in it: the owner may read it (`"read"`), the member's own procedures name them.
 * Without this option such a conversation is refused, so no other procedure acts on it.
 */
export type MemberConversationAccess = "read" | { memberUserId: string };

export async function resolveThreadTarget(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string; taskThreadId?: string },
  options: { includeArchived?: boolean; memberConversation?: MemberConversationAccess } = {},
): Promise<ThreadTarget> {
  if(input.taskThreadId&&(!input.botId||input.groupId))throw new IsolationError();
  const member = typeof options.memberConversation === "object" ? options.memberConversation : null;
  // A member's procedures reach only their own conversation, never a main chat or a group.
  if (member && (!input.taskThreadId || input.groupId)) throw new IsolationError();
  const repos = createRepos(prisma);
  const groupRepos = createGroupRepos(prisma);
  if (input.botId) {
    const bot = await repos.getBot(actor, input.botId, options);
    if (!bot.thread) throw new IsolationError();
    const taskThread = input.taskThreadId ? await prisma.thread.findFirst({where:{id:input.taskThreadId,taskBotId:bot.id,userId:actor.userId,spaceId:actor.spaceId}}) : null;
    if(input.taskThreadId && !taskThread) throw new IsolationError();
    if (member && taskThread?.memberUserId !== member.memberUserId) throw new IsolationError();
    if (taskThread?.memberUserId && !member && options.memberConversation !== "read")
      throw new ORPCError("FORBIDDEN", { message: SHARED_MICO_CONVERSATION_ERROR });
    return {
      kind: "bot",
      botId: bot.id,
      threadId: taskThread?.id ?? bot.thread.id,
      ...(taskThread && !isMicoTaskThread(taskThread) && !isInternalWorkThread(taskThread) && !(await isOwnedRoutineThread(prisma, actor, taskThread)) && !(await isOwnedWorkflowThread(prisma, actor, taskThread)) ? { projectSessionId: taskThread.id } : {}),
      bot,
      ...(taskThread?.memberUserId ? { memberUserId: taskThread.memberUserId } : {}),
    };
  }
  if (input.groupId) {
    const group = await groupRepos.getGroupTarget(actor, input.groupId);
    if (!group.thread) throw new IsolationError();
    const members = group.members.map((member) => ({
      botId: member.bot.id,
      name: member.bot.name,
      color: member.bot.color,
      status: primaryActiveRun(member.bot.runs)?.status ?? "idle",
    }));
    return {
      kind: "group",
      groupId: group.id,
      threadId: group.thread.id,
      groupName: group.name,
      members,
      memberBotIds: members.map((member) => member.botId),
    };
  }
  throw new IsolationError();
}

export async function threadHead(prisma: PrismaClient, target: ThreadTarget) {
  const latest = await prisma.event.findFirst({
    where: { threadId: target.threadId },
    orderBy: { seq: "desc" },
    select: { seq: true },
  });
  return { threadId: target.threadId, cursor: latest?.seq ?? -1 };
}

type SnapshotTarget = ThreadTarget | {
  kind: "bot";
  botId: string;
  threadId: string;
  bot: { name: string; computer: Parameters<typeof toComputerStatus>[1] & { id: string } | null };
};

/** Read-only side-chat admission. History doesn't need project execution metadata. */
export async function resolveThreadSnapshotTarget(
  prisma: PrismaClient,
  actor: Actor,
  input: { botId?: string; groupId?: string; taskThreadId?: string },
): Promise<SnapshotTarget> {
  if (!input.taskThreadId) {
    return resolveThreadTarget(prisma, actor, input, { includeArchived: true, memberConversation: "read" });
  }
  if (!input.botId || input.groupId) throw new IsolationError();
  const scope = { userId: actor.userId, spaceId: actor.spaceId };
  const thread = await prisma.thread.findFirst({
    where: {
      id: input.taskThreadId,
      taskBotId: input.botId,
      ...scope,
      taskBot: { is: { ...scope, thread: { isNot: null } } },
    },
    select: {
      id: true,
      taskBot: {
        select: {
          name: true,
          computer: {
            select: {
              id: true, kind: true, state: true, scope: true, controlHolder: true,
              controlBotId: true, controlRunId: true, homeRevision: true, maintenanceId: true,
            },
          },
        },
      },
    },
  });
  // As with the general read route, the Mico owner can read its member conversations.
  if (!thread?.taskBot) throw new IsolationError();
  return { kind: "bot", botId: input.botId, threadId: thread.id, bot: thread.taskBot };
}

export async function threadSnapshot(
  deps: { prisma: PrismaClient },
  target: SnapshotTarget,
  history?: "recent",
): Promise<ThreadSnapshot> {
  // Read messages, the event cursor, runs and progress from one MVCC snapshot.
  // Repeatable Read keeps the cursor aligned with the ask card without waiting
  // for a writer that holds the thread row lock.
  const readOptions = { isolationLevel: "RepeatableRead", timeout: 15_000, maxWait: 5_000 } as const;
  const loadHistory = async (tx: Prisma.TransactionClient, activeRuns: Promise<readonly unknown[]>) => {
    // An active run may need an older question or takeover card in the normal window.
    const idleRecent = history === "recent" && (await activeRuns).length === 0;
    const size = idleRecent ? RECENT_THREAD_MESSAGE_PAGE_SIZE : THREAD_MESSAGE_PAGE_SIZE;
    return loadMessagePage(tx, target.threadId, undefined, size);
  };
  if (target.kind === "bot") {
    const [busyBotName, core] = await Promise.all([
      resolveBusyBotName(deps.prisma, {
        computerId: target.bot.computer?.id,
        botId: target.botId,
        botName: target.bot.name,
      }),
      deps.prisma.$transaction(
        async (tx) => {
          const activeRunRead = tx.run.findMany({
            where: {
              botId: target.botId,
              threadId: target.threadId,
              status: { in: [...ACTIVE_RUN_STATUSES] },
              OR: [
                { trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] } },
                { status: { in: ["waiting_input", "waiting_takeover"] } },
              ],
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }).then(runs => runs);
          // Any foreground active run is already in activeRunRead. Without active
          // work only the newest foreground terminal can surface an error.
          const terminalRead = activeRunRead.then(runs => runs.length ? null : tx.run.findFirst({
            where: {
              botId: target.botId,
              threadId: target.threadId,
              trigger: { notIn: [...BACKGROUND_RUN_TRIGGERS] },
              status: { in: ["failed", "completed", "cancelled"] },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          }));
          const [messagePage, last, activeRuns, terminal] = await Promise.all([
            loadHistory(tx, activeRunRead),
            tx.event.findFirst({
              where: { threadId: target.threadId },
              orderBy: { seq: "desc" },
              select: { seq: true },
            }),
            activeRunRead,
            terminalRead,
          ]);
          const currentRun =
            pickPrimaryPrivateActiveRun(activeRuns) ?? (terminal?.status === "failed" ? terminal : null);
          const liveRuns = activeRuns.filter((run) => run.trigger !== "bot_message");
          const liveEvents =
            liveRuns.length > 0
              ? await tx.event.findMany({
                  where: {
                    threadId: target.threadId,
                    runId: { in: liveRuns.map((run) => run.id) },
                    type: {
                      in: [
                        "thread.progress",
                        "thread.subagent",
                        "run.waiting_input",
                        "computer.takeover.requested",
                        "agent.tool.called",
                        "agent.tool.completed",
                      ],
                    },
                  },
                  orderBy: { seq: "asc" },
                })
              : [];
          return { messagePage, last, run: currentRun, activeRuns, liveEvents };
        },
        readOptions,
      ),
    ]);
    const queuedBehind =
      core.run?.status === "queued" && !target.memberUserId
        ? await queuedBehindConversation(deps.prisma, target, core.run.id)
        : null;
    return {
      botId: target.botId,
      threadId: target.threadId,
      cursor: core.last?.seq ?? -1,
      messages: messagesWithLiveEvents(core.messagePage.messages, core.liveEvents, core.activeRuns),
      olderCursor: core.messagePage.olderCursor,
      run: core.run ? mapRun(core.run) : null,
      activeRuns: core.activeRuns.map(mapRun),
      computer: toComputerStatus(target.botId, target.bot.computer, busyBotName),
      ...(queuedBehind ? { queuedBehind } : {}),
    };
  }

  const core = await deps.prisma.$transaction(
    async (tx) => {
      const activeRunRead = tx.run.findMany({
        where: {
          threadId: target.threadId,
          status: { in: [...ACTIVE_RUN_STATUSES] },
          // Waiting peer and ticket asks stay answerable. Busy ticket runs stay off
          // the transcript; only their waiting_input / waiting_takeover states surface.
          OR: [
            { trigger: { notIn: ["bot_message", ...BACKGROUND_RUN_TRIGGERS] } },
            { status: { in: ["waiting_input", "waiting_takeover"] } },
          ],
        },
        orderBy: { createdAt: "desc" },
      }).then(runs => runs);
      const [messagePage, last, activeRuns, recentTerminals] = await Promise.all([
        loadHistory(tx, activeRunRead),
        tx.event.findFirst({
          where: { threadId: target.threadId },
          orderBy: { seq: "desc" },
          select: { seq: true },
        }),
        activeRunRead,
        // Recently updated terminals (completion bumps updatedAt). pickLatestTerminalRun then
        // ranks by completedAt ?? createdAt so null timestamps cannot revive a stale failure.
        tx.run.findMany({
          where: {
            threadId: target.threadId,
            trigger: { notIn: ["bot_message", ...BACKGROUND_RUN_TRIGGERS] },
            status: { in: ["failed", "completed", "cancelled"] },
          },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          take: 50,
        }),
      ]);
      const liveEvents =
        activeRuns.length > 0
          ? await tx.event.findMany({
              where: {
                threadId: target.threadId,
                runId: { in: activeRuns.map((run) => run.id) },
                type: {
                  in: [
                    "thread.progress",
                    "thread.subagent",
                    "run.waiting_input",
                    "computer.takeover.requested",
                    "agent.tool.called",
                    "agent.tool.completed",
                  ],
                },
              },
              orderBy: { seq: "asc" },
            })
          : [];
      return {
        messagePage,
        last,
        activeRuns,
        terminalRun: pickLatestTerminalRun(recentTerminals),
        liveEvents,
      };
    },
    readOptions,
  );
  const primaryActiveRun = pickPrimaryActiveRun(core.activeRuns);
  return {
    groupId: target.groupId,
    groupName: target.groupName,
    members: target.members,
    threadId: target.threadId,
    cursor: core.last?.seq ?? -1,
    messages: messagesWithLiveEvents(core.messagePage.messages, core.liveEvents, core.activeRuns),
    olderCursor: core.messagePage.olderCursor,
    // Match the live reducer: a failed latest terminal stays in run even while siblings are
    // still active or start late. A newer completed/cancelled terminal clears it.
    run:
      core.terminalRun?.status === "failed"
        ? mapRun(core.terminalRun)
        : primaryActiveRun
          ? mapRun(primaryActiveRun)
          : null,
    activeRuns: core.activeRuns.map(mapRun),
  };
}

/**
 * The owner's conversation whose live turn keeps this queued turn waiting: the oldest turn of
 * the same Mico working in another of the owner's conversations. A Space member's conversation
 * is never named, so a shared Mico never reveals one person's chats to another.
 */
export async function queuedBehindConversation(
  prisma: Pick<PrismaClient, "run">,
  target: Extract<ThreadTarget, { kind: "bot" }>,
  queuedRunId: string,
): Promise<{ threadId: string; title: string | null; main: boolean } | null> {
  const blocker = await prisma.run.findFirst({
    where: {
      botId: target.botId,
      id: { not: queuedRunId },
      threadId: { not: target.threadId },
      status: { in: ["leased", "running"] },
      leaseExpiresAt: { gt: new Date() },
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: {
      threadId: true,
      thread: { select: { title: true, memberUserId: true, archivedAt: true, deleteAfter: true } },
      routine: { select: { name: true } },
    },
  });
  if (!blocker || blocker.thread.memberUserId) return null;
  const main = blocker.threadId === target.bot.thread?.id;
  const hidden = Boolean(blocker.thread.archivedAt || blocker.thread.deleteAfter);
  return {
    threadId: blocker.threadId,
    title: main || hidden ? null : (blocker.thread.title ?? blocker.routine?.name ?? null),
    main,
  };
}

/** Keep waiting asks and takeovers in the group headline ahead of newer busy runs. */
function pickPrimaryActiveRun<T extends { status: string }>(runs: readonly T[]): T | undefined {
  return (
    runs.find((run) => run.status === "waiting_input" || run.status === "waiting_takeover") ??
    runs[0]
  );
}

/** Private threads prioritize takeover, then live work, while pending cards stay active. */
function pickPrimaryPrivateActiveRun<T extends { status: string }>(
  runs: readonly T[],
): T | undefined {
  return (
    runs.find((run) => run.status === "waiting_takeover") ??
    runs.find((run) => run.status === "running") ??
    runs.find((run) => run.status === "leased") ??
    runs[0]
  );
}

/** Latest terminal by end time (completedAt, else createdAt), then createdAt, then id. */
function pickLatestTerminalRun<T extends { id: string; createdAt: Date; completedAt: Date | null }>(
  runs: T[],
): T | null {
  if (runs.length === 0) return null;
  return runs.reduce((best, run) => {
    const bestEnd = (best.completedAt ?? best.createdAt).getTime();
    const runEnd = (run.completedAt ?? run.createdAt).getTime();
    if (runEnd !== bestEnd) return runEnd > bestEnd ? run : best;
    if (run.createdAt.getTime() !== best.createdAt.getTime()) {
      return run.createdAt > best.createdAt ? run : best;
    }
    return run.id > best.id ? run : best;
  });
}

function messagesWithLiveEvents(
  persisted: ThreadSnapshot["messages"],
  liveEvents: Parameters<typeof projectMessages>[0],
  runs: NonNullable<Parameters<typeof projectMessages>[1]>,
) {
  const live = projectMessages(liveEvents, runs).filter((message) => {
    if (message.blocks.some((block) => block.kind === "progress" || block.kind === "steps")) {
      return true;
    }
    if (!message.id.startsWith("subagent:")) return false;
    return !persisted.some((row) =>
      row.blocks.some(
        (block) => block.kind === "subagent" && message.id === `subagent:${block.agentId}`,
      ),
    );
  });
  return [...persisted, ...live];
}

function mapRun(run: {
  id: string;
  userId: string;
  botId: string;
  threadId: string;
  taskId: string;
  status: string;
  trigger: string;
  routineId: string | null;
  modelProvider: string | null;
  modelId: string | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt?: Date;
  leaseExpiresAt?: Date | null;
  wakeAt?: Date | null;
}) {
  return {
    id: run.id,
    userId: run.userId,
    botId: run.botId,
    threadId: run.threadId,
    taskId: run.taskId,
    status: run.status as never,
    trigger: run.trigger as never,
    routineId: run.routineId ?? null,
    modelProvider: run.modelProvider,
    modelId: run.modelId,
    // Same display clamp as live run.failed events so a huge stored error cannot bypass it.
    error:
      run.status === "failed"
        ? runFailureError({ type: "run.failed", payload: { error: run.error } })
        : run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    ...(run.updatedAt
      ? {
          updatedAt: run.updatedAt.toISOString(),
          leaseExpiresAt: run.leaseExpiresAt?.toISOString() ?? null,
          wakeAt: run.wakeAt?.toISOString() ?? null,
          observedAt: new Date().toISOString(),
        }
      : {}),
  };
}

export async function sendThreadMessage(
  deps: {
    prisma: PrismaClient;
    events: ThreadEvents;
    jobs: JobPublisher;
  },
  actor: Actor,
  target: ThreadTarget,
  input: {
    text?: string;
    artifactIds?: string[];
    mentions?: MentionTargetInput[];
    replyToMessageId?: string;
    replyQuote?: string;
    clientNonce?: string;
    responseLocale?: string;
    taskInstructions?: string;
    delivery?: "queue" | "steer";
    /**
     * The Space member writing in their own conversation with a shared Mico: their message and
     * the turn it starts name them, while `actor` (the Mico's owner) owns and pays for both.
     */
    author?: string;
  },
  releaseTakeover?: (runId: string) => Promise<void>,
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  const authorUserId = input.author;
  if(input.taskInstructions){const ownTask=await deps.prisma.thread.findFirst({where:{id:target.threadId,taskBotId:target.kind==="bot"?target.botId:"",spaceId:actor.spaceId,userId:actor.userId}});if(!ownTask)throw new IsolationError();}
  const existing = await replayExistingSend(
    deps,
    target.threadId,
    input.clientNonce,
    input.delivery === "queue" ? undefined : releaseTakeover,
  );
  if (existing) return existing;
  // Live events carry the call id so a spoken turn joins the call card on first
  // paint; without it the bubble shows loose until a refetch reads the nonce.
  const callId = callIdFromClientNonce(input.clientNonce);
  const requestedReplyQuote = input.replyQuote?.trim() || undefined;
  if (requestedReplyQuote && !input.replyToMessageId) {
    throw new ORPCError("BAD_REQUEST", { message: "replyQuote requires replyToMessageId." });
  }

  const commit = () =>
    deps.prisma.$transaction(async (tx) => {
      await beforeCommit?.(tx);
      let replyToMessageId: string | undefined;
      let replyQuote: string | undefined;
      let replyPreview: ReplyPreview | null | undefined;
      if (input.replyToMessageId) {
        const reply = await tx.message.findFirst({
          where: { id: input.replyToMessageId, threadId: target.threadId },
          select: { id: true, blocks: true, role: true, botId: true },
        });
        // A missing target must not lose the send or retain an unverified id.
        // The empty server-owned quote preserves the unavailable state after reload.
        if (!reply) {
          replyQuote = "";
          replyPreview = null;
        } else {
          replyToMessageId = input.replyToMessageId;
          const parsed = MessageBlockSchema.array().safeParse(reply.blocks);
          replyPreview = null;
          if (parsed.success) {
            replyPreview = messageReplyPreview(
              parsed.data,
              reply.role as ReplyPreview["role"],
              reply.botId ?? undefined,
            );
            // Attachment labels stay in the preview; only selected text is persisted as a quote.
            if (!requestedReplyQuote && !replyPreview.attachment) {
              replyQuote = replyPreview.text || undefined;
            }
          }
          // Persist only text derived from the authoritative parent. A
          // mismatch or a derivation failure still sends a plain reply so
          // quote verification cannot lose a message.
          if (requestedReplyQuote && parsed.success) {
            try {
              replyQuote = deriveMessageQuote(
                parsed.data,
                requestedReplyQuote,
                reply.role === "user" ? "plain-text" : "markdown",
              );
            } catch (error) {
              getLogger().error("thread send quote derivation", error);
              replyQuote = undefined;
            }
          }
        }
      }

      if (target.kind === "bot") {
        const mentionTargets = splitMentionTargets(input.mentions);
        const { blocks: attachmentBlocks, artifacts } = await resolveSendAttachments(
          { prisma: tx },
          actor,
          target.botId,
          input.artifactIds,
        );
        const connectorNames = await resolveOwnedConnectorDisplayNames(
          tx,
          actor,
          mentionTargets.connectorMentionIds,
        );
        const threadLinks = await resolveThreadLinks(tx, actor, target.botId, mentionTargets.threadMentionIds);
        const blocks = [...buildUserMessageBlocks(input.text, attachmentBlocks), ...threadLinks];
        const message = await createThreadMessageInTransaction(tx, {
          threadId: target.threadId,
          role: "user",
          blocks,
          replyToMessageId,
          replyQuote,
          clientNonce: input.clientNonce,
          authorUserId,
        });
        const activeRuns = await tx.run.findMany({
          where: {
            threadId: target.threadId,
            botId: target.botId,
            status: { in: [...ACTIVE_RUN_STATUSES] },
          },
          select: { id: true, taskId: true, status: true, trigger: true },
        });
        const answered: typeof activeRuns = [];
        for (const run of activeRuns.filter((run) => run.status === "waiting_input")) {
          if (
            await answerWaitingRunWithTextInTransaction(tx, {
              spaceId: actor.spaceId,
              threadId: target.threadId,
              runId: run.id,
              answeredByUserId: authorUserId ?? actor.userId,
              answer: input.text ?? "",
              beforeMessageSeq: message.seq,
            })
          )
            answered.push({ ...run, status: "queued" });
          else
            await retireWaitingQuestionInTransaction(tx, {
              spaceId: actor.spaceId,
              threadId: target.threadId,
              botId: target.botId,
              runId: run.id,
              answer: input.text ?? "",
            });
        }
        if (answered.length) {
          const primary = answered[0];
          if (!primary) throw new IsolationError();
          await tx.message.update({ where: { id: message.id }, data: { runId: primary.id } });
          const event = await appendEventInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: target.threadId,
            botId: target.botId,
            type: "thread.message.created",
            runId: primary.id,
            payload: {
              messageId: message.id,
              seq: message.seq,
              role: "user",
              clientNonce: input.clientNonce,
              ...(authorUserId ? { authorUserId } : {}),
              blocks,
              callId,
              runIds: answered.map((run) => run.id),
              replyToMessageId,
              replyQuote,
              replyPreview,
            },
          });
          return { message, runs: answered, eventSeq: event.seq };
        }
        const holdingRuns = activeRuns.filter((run) =>
          QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status),
        );
        const active = holdingRuns.find(steersUserMessage) ?? holdingRuns[0];
        if (active) {
          await tx.steeringMessage.create({
            data: {
              messageId: message.id,
              botId: target.botId,
              userId: actor.userId,
              runId: input.delivery === "queue" ? null : steersUserMessage(active) ? active.id : null,
              // A queued message waits at the end of the queue, in the order it was sent.
              ...(input.delivery === "queue" ? { originTrigger: "queued_user", position: message.seq } : {}),
            },
          });
          await tx.message.update({ where: { id: message.id }, data: { runId: active.id } });
          const event = await appendEventInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: target.threadId,
            botId: target.botId,
            type: "thread.message.created",
            runId: active.id,
            payload: {
              messageId: message.id,
              seq: message.seq,
              role: "user",
              clientNonce: input.clientNonce,
              ...(authorUserId ? { authorUserId } : {}),
              blocks,
              callId,
              replyToMessageId,
              replyQuote,
              replyPreview,
            },
          });
          return { message, runs: [active], eventSeq: event.seq };
        }
        const task = await tx.task.create({
          data: {
            spaceId: actor.spaceId,
            botId: target.botId,
            threadId: target.threadId,
            userId: actor.userId,
            prompt: withResponseLanguage(
              (input.taskInstructions ? input.taskInstructions + "\n\nCurrent user request:\n" : "") + threadLinkPrompt(buildSendPrompt(input.text, artifacts, connectorNames), threadLinks),
              input.responseLocale,
            ),
            status: "queued",
          },
        });
        const run = await tx.run.create({
          data: {
            spaceId: actor.spaceId,
            botId: target.botId,
            threadId: target.threadId,
            taskId: task.id,
            userId: actor.userId,
            ...(authorUserId ? { requestedByUserId: authorUserId } : {}),
            status: "queued",
            trigger: "user",
            clientNonce: sendRunClientNonce(input.clientNonce, message.id),
            sourceMessageId: message.id,
          },
        });
        await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
        await cancelSupersededQueuedRuns(tx, {
          threadId: target.threadId,
          botIds: [target.botId],
          keepRunIds: [run.id],
        });
        const event = await appendEventInTransaction(tx, {
          spaceId: actor.spaceId,
          threadId: target.threadId,
          botId: target.botId,
          type: "thread.message.created",
          runId: run.id,
          payload: {
            messageId: message.id,
            seq: message.seq,
            role: "user",
            clientNonce: input.clientNonce,
            ...(authorUserId ? { authorUserId } : {}),
            blocks,
            callId,
            runIds: [run.id],
            replyToMessageId,
            replyQuote,
            replyPreview,
          },
        });
        return { message, runs: [run], eventSeq: event.seq };
      }

      const { members, leadBotId } = await lockAndLoadGroup(tx, actor, target);
      const memberBotIds = members.map((member) => member.botId);
      const mentionTargets = splitMentionTargets(input.mentions);
      const memberRefs = members.map((member) => ({ id: member.botId, name: member.name }));
      const addressed = addressedGroupBotIds({
        text: input.text ?? "",
        members: memberRefs,
        explicitMentions: mentionTargets.botMentionIds,
      });
      // "continue" with nobody named picks up the stopped work of the newest request; any
      // other message names its members or goes to the lead. Routing never asks a model.
      const continuing =
        addressed.length === 0 && isContinueRequest(input.text ?? "")
          ? await stoppedGroupWork(tx, target.threadId, memberBotIds)
          : undefined;
      const targetBotIds =
        continuing?.botIds ??
        resolveGroupTargetBotIds({
          text: input.text ?? "",
          members: memberRefs,
          explicitMentions: mentionTargets.botMentionIds,
          leadBotId,
        });
      const { blocks: attachmentBlocks, artifacts } = await resolveGroupSendAttachments(
        { prisma: tx },
        actor,
        target.groupId,
        memberBotIds,
        input.artifactIds,
      );
      const connectorNames = await resolveOwnedConnectorDisplayNames(
        tx,
        actor,
        mentionTargets.connectorMentionIds,
      );
      const blocks = buildUserMessageBlocks(input.text, attachmentBlocks);
      const message = await createThreadMessageInTransaction(tx, {
        threadId: target.threadId,
        role: "user",
        blocks,
        replyToMessageId,
        replyQuote,
        clientNonce: input.clientNonce,
      });
      const activeRuns = await tx.run.findMany({
        where: {
          threadId: target.threadId,
          botId: { in: targetBotIds },
          status: { in: [...ACTIVE_RUN_STATUSES] },
        },
        select: { id: true, taskId: true, botId: true, status: true, trigger: true },
      });
      const activeByBotId = new Map<string, (typeof activeRuns)[number]>();
      const answeredByBotId = new Map<string, Array<(typeof activeRuns)[number]>>();
      for (const run of activeRuns) {
        if (run.status === "waiting_input") {
          const answered = await answerWaitingRunWithTextInTransaction(tx, {
            spaceId: actor.spaceId,
            threadId: target.threadId,
            runId: run.id,
            answeredByUserId: actor.userId,
            answer: input.text ?? "",
            beforeMessageSeq: message.seq,
          });
          if (answered) {
            const queuedForBot = answeredByBotId.get(run.botId) ?? [];
            queuedForBot.push({ ...run, status: "queued" });
            answeredByBotId.set(run.botId, queuedForBot);
          } else {
            await retireWaitingQuestionInTransaction(tx, {
              spaceId: actor.spaceId,
              threadId: target.threadId,
              botId: run.botId,
              runId: run.id,
              answer: input.text ?? "",
            });
          }
          continue;
        }
        if (!STEERABLE_RUN_STATUSES.has(run.status)) continue;
        const current = activeByBotId.get(run.botId);
        if (!current || (!steersUserMessage(current) && steersUserMessage(run))) {
          activeByBotId.set(run.botId, run);
        }
      }
      const runs: Array<{ id: string; taskId: string; botId: string; status: string }> = [];
      for (const botId of targetBotIds) {
        const answered = answeredByBotId.get(botId);
        if (answered) {
          runs.push(...answered);
          continue;
        }
        const active = activeByBotId.get(botId);
        if (active) {
          await tx.steeringMessage.create({
            data: {
              messageId: message.id,
              botId,
              userId: actor.userId,
              runId: input.delivery === "queue" ? null : steersUserMessage(active) ? active.id : null,
              // A queued message waits at the end of the queue, in the order it was sent.
              ...(input.delivery === "queue" ? { originTrigger: "queued_user", position: message.seq } : {}),
            },
          });
          runs.push(active);
          continue;
        }
        const task = await tx.task.create({
          data: {
            spaceId: actor.spaceId,
            botId,
            threadId: target.threadId,
            userId: actor.userId,
            prompt: withResponseLanguage(
              continuing
                ? groupContinuePrompt(continuing.requestText)
                : buildSendPrompt(input.text, artifacts, connectorNames),
              input.responseLocale,
            ),
            status: "queued",
          },
        });
        const run = await tx.run.create({
          data: {
            spaceId: actor.spaceId,
            botId,
            threadId: target.threadId,
            taskId: task.id,
            userId: actor.userId,
            status: "queued",
            trigger: "user",
            clientNonce: sendRunClientNonce(input.clientNonce, message.id, botId),
            sourceMessageId: message.id,
          },
        });
        runs.push(run);
      }
      const firstRun = runs[0];
      const eventBotId = firstRun?.botId ?? targetBotIds[0];
      if (!eventBotId) throw new IsolationError("Group send did not resolve a target");
      if (firstRun) {
        await tx.message.update({ where: { id: message.id }, data: { runId: firstRun.id } });
        const createdRuns = runs.filter(
          (run) => !activeByBotId.has(run.botId) && !answeredByBotId.has(run.botId),
        );
        if (createdRuns.length) {
          await cancelSupersededQueuedRuns(tx, {
            threadId: target.threadId,
            botIds: createdRuns.map((run) => run.botId),
            keepRunIds: createdRuns.map((run) => run.id),
          });
        }
      }
      await touchGroupUpdatedAt(tx, target.groupId);
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: target.threadId,
        botId: eventBotId,
        type: "thread.message.created",
        runId: firstRun?.id ?? activeRuns[0]?.id,
        payload: {
          messageId: message.id,
          seq: message.seq,
          role: "user",
          clientNonce: input.clientNonce,
          blocks,
          callId,
          runIds: runs.map((run) => run.id),
          replyToMessageId,
          replyQuote,
          replyPreview,
        },
      });
      return { message, runs, eventSeq: event.seq };
    });

  const committed = await withSerializableRetry(commit).catch(async (error) => {
    const winner = await replayExistingSend(
      deps,
      target.threadId,
      input.clientNonce,
      input.delivery === "queue" ? undefined : releaseTakeover,
    );
    if (winner) return { replay: winner } as const;
    throw error;
  });
  if ("replay" in committed) return committed.replay;
  const notification = deps.events.notify(target.threadId, committed.eventSeq).catch((error) => {
    // Subscribers catch up from the durable event cursor after a missed realtime wake.
    getLogger().error("thread send realtime notification", error);
  });
  if (releaseTakeover && input.delivery !== "queue") {
    for (const run of committed.runs) {
      if (!steersUserMessage(run)) continue;
      await notification;
      await releaseTakeover(run.id);
    }
  }
  // The message and its event already committed. A slow subscriber wake must
  // not delay the worker; subscribers read the durable events in sequence.
  await Promise.all([notification, enqueueRunsNeedingContinue(deps.jobs, committed.runs)]);
  return sendResult(committed.message, committed.runs);
}

const REACTION_TURN_COOLDOWN_MS = 30_000;

/**
 * Append a human emoji reply with its target. Any reaction to the bot's latest
 * message may wake it, with silence allowed. Only thumbs answer an ordinary pending
 * ask; busy bots, recent reaction turns, and older targets stay quiet context.
 * A 👍 on a pending takeover counts as done and hands computer control back.
 * Approval and secret asks remain on their cards. Reactions are append-only.
 */
export async function reactToThreadMessage(
  deps: { prisma: PrismaClient; jobs: JobPublisher },
  actor: Actor,
  target: ThreadTarget,
  input: {
    messageId: string;
    reaction: MessageReaction;
    clientNonce: string;
    /** False when a send could not start a run either (no model, teaching). */
    mayStartTurn: boolean;
  },
  releaseTakeover?: (runId: string) => Promise<void>,
) {
  const committed = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const parent = await tx.message.findFirst({
      where: { id: input.messageId, threadId: target.threadId },
      select: { id: true, seq: true, role: true, botId: true, runId: true },
    });
    if (!parent) throw new IsolationError();
    const existing = await tx.message.findUnique({
      where: {
        threadId_clientNonce: { threadId: target.threadId, clientNonce: input.clientNonce },
      },
      select: { id: true },
    });
    if (existing) {
      // A retry finishes a takeover handoff whose release failed after the 👍 was saved.
      const steering = releaseTakeover
        ? await tx.steeringMessage.findFirst({
            where: { messageId: existing.id, claimedAt: null },
            select: { run: { select: { id: true, taskId: true, status: true } } },
          })
        : null;
      const run = steering?.run;
      return { eventSeq: null, runs: run?.status === "waiting_takeover" ? [run] : [] };
    }
    const members =
      target.kind === "group" ? await lockAndLoadGroupMembers(tx, actor, target) : undefined;
    const currentTarget = members
      ? { ...target, memberBotIds: members.map((member) => member.botId) }
      : target;
    const replyBotId = input.mayStartTurn
      ? await reactionReplyBotId(tx, currentTarget, parent)
      : undefined;
    const botId =
      replyBotId ??
      (currentTarget.kind === "bot" ? currentTarget.botId : currentTarget.memberBotIds[0]);
    if (!botId) throw new IsolationError();
    const blocks: MessageBlock[] = [{ kind: "text", text: input.reaction }];
    const message = await createThreadMessageInTransaction(tx, {
      threadId: target.threadId,
      role: "user",
      blocks,
      replyToMessageId: parent.id,
      clientNonce: input.clientNonce,
    });
    const runs = replyBotId
      ? await startReactionTurn(tx, actor, target.threadId, replyBotId, parent, message, {
          ...input,
          canReleaseTakeover: Boolean(releaseTakeover),
        })
      : [];
    if (target.kind === "group") await touchGroupUpdatedAt(tx, target.groupId);
    const event = await appendEventInTransaction(tx, {
      spaceId: actor.spaceId,
      threadId: target.threadId,
      botId,
      type: "thread.message.created",
      ...(runs[0] ? { runId: runs[0].id } : {}),
      payload: {
        messageId: message.id,
        role: "user",
        blocks,
        replyToMessageId: parent.id,
        ...(runs.length ? { runIds: runs.map((run) => run.id) } : {}),
      },
    });
    return { eventSeq: event.seq, runs };
  });
  if (releaseTakeover) {
    for (const run of committed.runs) {
      if (run.status === "waiting_takeover") await releaseTakeover(run.id);
    }
  }
  await enqueueRunsNeedingContinue(deps.jobs, committed.runs);
  return { eventSeq: committed.eventSeq, runIds: committed.runs.map((run) => run.id) };
}

/** The bot that wrote the thread's newest message, when the reaction targets that message. */
async function reactionReplyBotId(
  tx: Prisma.TransactionClient,
  target: ThreadTarget,
  parent: { seq: number; role: string; botId: string | null },
) {
  // Only the authenticated human reaction route calls this path; bots cannot wake each other.
  if (parent.role !== "bot" || !parent.botId) return undefined;
  const memberBotIds = target.kind === "bot" ? [target.botId] : target.memberBotIds;
  if (!memberBotIds.includes(parent.botId)) return undefined;
  // Earlier reactions may follow it; any other message means the conversation moved on.
  const newer = await tx.message.findMany({
    where: { threadId: target.threadId, seq: { gt: parent.seq } },
    orderBy: { seq: "asc" },
    take: 51,
    select: { role: true, blocks: true, replyToMessageId: true },
  });
  if (newer.length > 50) return undefined;
  const onlyReactions = newer.every((message) =>
    messageReaction({
      ...message,
      blocks: Array.isArray(message.blocks) ? (message.blocks as MessageBlock[]) : [],
    }),
  );
  return onlyReactions ? parent.botId : undefined;
}

async function startReactionTurn(
  tx: Prisma.TransactionClient,
  actor: Actor,
  threadId: string,
  botId: string,
  parent: { id: string; runId: string | null },
  message: { id: string; seq: number },
  input: { reaction: MessageReaction; clientNonce: string; canReleaseTakeover: boolean },
): Promise<Array<{ id: string; taskId: string; status: string }>> {
  const activeRuns = await tx.run.findMany({
    where: { threadId, botId, status: { in: [...ACTIVE_RUN_STATUSES] } },
    select: { id: true, taskId: true, status: true },
  });
  const holdingRuns = activeRuns.filter((run) =>
    QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status),
  );
  const active = activeRuns.find((run) => run.id === parent.runId) ?? holdingRuns[0];
  const others = holdingRuns.filter((run) => run.id !== active?.id);
  if (active) {
    // A 👍 while this run waits for the user to finish on the computer means "done", the
    // same as a typed reply: it steers the run and the caller hands control back.
    // Only when the caller can hand control back (bot threads), as with a typed reply.
    if (
      input.canReleaseTakeover &&
      input.reaction === "👍" &&
      !others.length &&
      active.status === "waiting_takeover" &&
      active.id === parent.runId
    ) {
      await tx.steeringMessage.create({
        data: { messageId: message.id, botId, userId: actor.userId, runId: active.id },
      });
      await tx.message.update({ where: { id: message.id }, data: { runId: active.id } });
      return [active];
    }
    if (
      (input.reaction === "👍" || input.reaction === "👎") &&
      active.status === "waiting_input" &&
      active.id === parent.runId
    ) {
      const answered = await answerWaitingRunWithTextInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId,
        runId: active.id,
        answeredByUserId: actor.userId,
        answer: input.reaction === "👍" ? "yes" : "no",
        messageId: parent.id,
      });
      if (answered) {
        await tx.message.update({ where: { id: message.id }, data: { runId: active.id } });
        return [{ ...active, status: "queued" }];
      }
      // Approval and secret cards still require an explicit card answer.
      return [];
    }
    if (holdingRuns.length) return [];
  }
  // The cooldown limits new turns only, so a quick answer to a pending ask still goes through.
  const recentReaction = await tx.run.findFirst({
    where: {
      threadId,
      botId,
      trigger: "reaction",
      status: { not: "cancelled" },
      createdAt: { gte: new Date(Date.now() - REACTION_TURN_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recentReaction) return [];
  const task = await tx.task.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      userId: actor.userId,
      prompt: input.reaction,
      status: "queued",
    },
  });
  const run = await tx.run.create({
    data: {
      spaceId: actor.spaceId,
      botId,
      threadId,
      taskId: task.id,
      userId: actor.userId,
      status: "queued",
      trigger: "reaction",
      clientNonce: sendRunClientNonce(input.clientNonce, message.id),
      sourceMessageId: message.id,
    },
  });
  await tx.message.update({ where: { id: message.id }, data: { runId: run.id } });
  await cancelSupersededQueuedRuns(tx, { threadId, botIds: [botId], keepRunIds: [run.id] });
  return [run];
}

export async function stopThreadRuns(
  deps: {
    prisma: PrismaClient;
    sandbox: SandboxProvider;
    events: ThreadEvents;
    /** Starts the report a stopped Mico-opened task sends; the reconciler repairs a miss. */
    jobs?: Pick<JobPublisher, "enqueue">;
  },
  actor: Actor,
  target: ThreadTarget,
  only?: string[] | { runId: string; trigger: "project_prepare" },
) {
  const { runIds, computers, leases, eventSeq, taskReport, resumeRunIds } = await deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const cancelled = await tx.run.updateManyAndReturn({
      where: {
        threadId: target.threadId,
        ...(Array.isArray(only) ? { id: { in: only } } : only ? { id: only.runId, trigger: only.trigger, userId: actor.userId, spaceId: actor.spaceId } : {}),
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      data: { status: "cancelled", completedAt: new Date() },
      select: { id: true, botId: true },
    });
    const ids = cancelled.map((run) => run.id);
    await clearEndedRunState(tx, ids);
    // A stopped turn reads as stopped on its conversation until the next turn.
    await recordThreadTurnOutcome(tx, { threadId: target.threadId, runIds: ids, outcome: "interrupted" });
    // A task the Mico opened tells its main chat that the person stopped it.
    const taskReport =
      target.kind === "bot" && ids.length
        ? await queueTaskReportInTransaction(tx, { threadId: target.threadId, runIds: ids, outcome: "stopped" })
        : null;
    await tx.steeringMessage.deleteMany({
      where: {
        botId: { in: target.kind === "bot" ? [target.botId] : target.memberBotIds },
        message: { threadId: target.threadId },
        ...(only ? { runId: { in: Array.isArray(only) ? only : ids } } : {}),
      },
    });
    // Snapshot teardown coordinates before commit. Once cancellation becomes
    // visible, a worker can release its lease / execution columns immediately; a
    // later lookup would then miss the sandbox work this request must stop.
    // Team ownership lives on ComputerExecutionLease; Computer.executionRunId is
    // only a legacy secondary path and is not written by current acquisition.
    const leases = ids.length
      ? await tx.computerExecutionLease.findMany({
          where: { runId: { in: ids } },
          select: { computerId: true, botId: true, runId: true, fence: true },
        })
      : [];
    const leaseComputerIds = [...new Set(leases.map((lease) => lease.computerId))];
    const computers = ids.length
      ? await tx.computer.findMany({
          where:
            leaseComputerIds.length > 0
              ? {
                  OR: [{ id: { in: leaseComputerIds } }, { executionRunId: { in: ids } }],
                }
              : { executionRunId: { in: ids } },
          select: {
            id: true,
            homeKey: true,
            kind: true,
            providerRef: true,
            executionBotId: true,
            executionRunId: true,
          },
        })
      : [];
    // One terminal event per cancelled run, in the same commit as the status
    // flip and the progress purge below. Other clients learn the run ended, and
    // the fresh seq keeps max(seq) above every deleted progress row so a client
    // whose cursor pointed at one never discards later refreshes as stale.
    let eventSeq: number | null = null;
    for (const run of cancelled) {
      const event = await appendEventInTransaction(tx, {
        spaceId: actor.spaceId,
        threadId: target.threadId,
        botId: run.botId,
        type: "run.cancelled",
        runId: run.id,
        payload: {},
      });
      eventSeq = event.seq;
    }
    if (ids.length) {
      await tx.event.deleteMany({
        where: {
          type: "thread.progress",
          runId: { in: ids },
        },
      });
    }
    // A stopped turn that answered another Mico's request settles that recipient; when it was
    // the last one, the sender's turn with every answer is queued here.
    const resumeRunIds = ids.length ? await settleStoppedRecipientsInTransaction(tx, ids) : [];
    return { runIds: ids, computers, leases, eventSeq, taskReport, resumeRunIds };
  });
  for (const resumeRunId of resumeRunIds) {
    await deps.jobs?.enqueue(runContinueJob(resumeRunId)).catch((error) => {
      getLogger().error("teammate answers enqueue", error);
    });
  }
  if (eventSeq !== null) {
    // The events are durable; subscribers refetch from their persisted cursor.
    await deps.events.notify(target.threadId, eventSeq).catch((error) => {
      getLogger().error("thread stop realtime notification", error);
    });
  }
  if (taskReport) {
    await deps.events.notify(taskReport.threadId, taskReport.seq).catch((error) => {
      getLogger().error("task report realtime notification", error);
    });
    await deps.jobs?.enqueue(runContinueJob(taskReport.runId)).catch((error) => {
      getLogger().error("task report enqueue", error);
    });
  }
  // Keep the DB lease until after teardown so a replacement run cannot claim the
  // screen while we still need the cancelled run's screenLeaseId to release it.
  const computerById = new Map(computers.map((computer) => [computer.id, computer]));
  const teardownTargets: Array<{
    computer: (typeof computers)[number];
    botId: string;
    runId: string;
    lease: (typeof leases)[number] | null;
  }> = [];
  const seenTargets = new Set<string>();
  for (const lease of leases) {
    const computer = computerById.get(lease.computerId);
    if (!computer) continue;
    const key = `${computer.id}:${lease.runId}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    teardownTargets.push({
      computer,
      botId: lease.botId,
      runId: lease.runId,
      lease,
    });
  }
  const cancelledRunIds = new Set(runIds);
  for (const computer of computers) {
    if (!computer.executionBotId || !computer.executionRunId) continue;
    // Computers may enter the snapshot via a cancelled lease while
    // Computer.executionRunId still points at an unrelated live run. Only treat
    // the legacy columns as a teardown target when they belong to a run we
    // cancelled in this transaction.
    if (!cancelledRunIds.has(computer.executionRunId)) continue;
    const key = `${computer.id}:${computer.executionRunId}`;
    if (seenTargets.has(key)) continue;
    seenTargets.add(key);
    teardownTargets.push({
      computer,
      botId: computer.executionBotId,
      runId: computer.executionRunId,
      lease: null,
    });
  }
  await Promise.all(
    teardownTargets.map(async ({ computer, botId, runId, lease }) => {
      if (!computer.providerRef) return;
      const context = {
        ...(target.kind==="bot"&&target.projectSessionId?{projectSessionId:target.projectSessionId}:{}),
        operationId: "stop",
        traceId: "stop",
        spaceId: actor.spaceId,
        userId: actor.userId,
        botId,
        runId,
        screenLeaseId: screenLeaseIdForRun(lease, runId),
        cancelRunWork: true,
        signal: new AbortController().signal,
      };
      const ref = toComputerRef(computer);
      await cancelComputerRunWork(deps.sandbox, ref, computer.id, runId, context);
      await deps.sandbox.releaseScreen?.(ref, context).catch(() => undefined);
    }),
  );
  await expireComputerExecutionLeases(deps.prisma, { runId: { in: runIds } });
  await deps.prisma.computer.updateMany({
    where: { executionRunId: { in: runIds } },
    data: {
      executionRunId: null,
      executionBotId: null,
      executionLeaseExpiresAt: null,
    },
  });
}

/**
 * Marks the thread read up to its latest message. Returns the seq the user had read up
 * to before, or null when the chat wasn't unread or nothing new arrived; the first
 * answer of a visit places the "New" divider. A message landing mid-update makes the
 * conditional write miss, so it retries rather than marking that message read; a chat
 * that stays that busy is read under the thread's row lock instead.
 */
export async function markThreadRead(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
): Promise<number | null> {
  const where = { id: target.threadId, spaceId: actor.spaceId, userId: actor.userId };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const thread = await prisma.thread.findFirst({
      where,
      select: { unread: true, lastReadSeq: true, nextMessageSeq: true },
    });
    if (!thread) return null;
    const latestSeq = thread.nextMessageSeq - 1;
    if (!thread.unread && thread.lastReadSeq >= latestSeq) return null;
    const result = await prisma.thread.updateMany({
      where: { ...where, lastReadSeq: thread.lastReadSeq, nextMessageSeq: thread.nextMessageSeq },
      data: { unread: false, lastReadSeq: latestSeq },
    });
    if (result.count > 1) throw new IsolationError();
    if (result.count === 1) return dividerSeq(thread, latestSeq);
  }
  // New messages take the same row lock, so none can land between this read and write.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM threads WHERE id = ${target.threadId} FOR UPDATE`;
    const thread = await tx.thread.findFirst({
      where,
      select: { unread: true, lastReadSeq: true, nextMessageSeq: true },
    });
    if (!thread) return null;
    const latestSeq = thread.nextMessageSeq - 1;
    if (!thread.unread && thread.lastReadSeq >= latestSeq) return null;
    const result = await tx.thread.updateMany({
      where,
      data: { unread: false, lastReadSeq: latestSeq },
    });
    if (result.count > 1) throw new IsolationError();
    return dividerSeq(thread, latestSeq);
  });
}

/** A chat only gets a divider when its unread dot was on, so replies seen live never do. */
function dividerSeq(thread: { unread: boolean; lastReadSeq: number }, latestSeq: number) {
  return thread.unread && thread.lastReadSeq < latestSeq ? thread.lastReadSeq : null;
}

/**
 * Marks the thread unread from one of its messages: the read cursor moves to just before it,
 * so the next open puts the New divider above that message.
 */
export async function markThreadUnreadFrom(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
  messageId: string,
) {
  const message = await prisma.message.findFirst({
    where: { id: messageId, threadId: target.threadId },
    select: { seq: true },
  });
  if (!message) throw new ORPCError("NOT_FOUND");
  const result = await prisma.thread.updateMany({
    where: { id: target.threadId, spaceId: actor.spaceId, userId: actor.userId },
    data: { unread: true, lastReadSeq: message.seq - 1 },
  });
  if (result.count > 1) throw new IsolationError();
}

export async function setThreadUnreadState(
  prisma: PrismaClient,
  actor: Actor,
  target: ThreadTarget,
  unread: boolean,
) {
  const result = await prisma.thread.updateMany({
    where: {
      id: target.threadId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      unread: { not: unread },
    },
    data: { unread },
  });
  if (result.count > 1) throw new IsolationError();
}

/**
 * The members whose work on the newest person's request in a group stopped before it finished:
 * stopped turns first, failed ones only when none was stopped. Undefined when nothing stopped.
 */
async function stoppedGroupWork(
  tx: Prisma.TransactionClient,
  threadId: string,
  memberBotIds: readonly string[],
): Promise<{ botIds: string[]; requestText: string } | undefined> {
  const request = await tx.message.findFirst({
    where: { threadId, role: "user", sourceRuns: { some: {} } },
    orderBy: { seq: "desc" },
    select: { createdAt: true, blocks: true },
  });
  if (!request) return undefined;
  const runs = await tx.run.findMany({
    where: {
      threadId,
      botId: { in: [...memberBotIds] },
      createdAt: { gte: request.createdAt },
      trigger: { in: ["user", "follow_up"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { botId: true, status: true },
    take: 100,
  });
  const latestByBot = new Map<string, string>();
  for (const run of runs) if (!latestByBot.has(run.botId)) latestByBot.set(run.botId, run.status);
  if ([...latestByBot.values()].some((status) => ACTIVE_RUN_STATUSES.includes(status as never))) return undefined;
  const stopped = [...latestByBot].filter(([, status]) => status === "cancelled").map(([botId]) => botId);
  const failed = [...latestByBot].filter(([, status]) => status === "failed").map(([botId]) => botId);
  const botIds = stopped.length ? stopped : failed;
  if (!botIds.length) return undefined;
  const blocks = Array.isArray(request.blocks) ? (request.blocks as MessageBlock[]) : [];
  const requestText = blocks
    .flatMap((block) => (block.kind === "text" ? [block.text] : []))
    .join("\n\n")
    .trim();
  return { botIds, requestText };
}
