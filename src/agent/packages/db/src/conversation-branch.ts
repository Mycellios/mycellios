import type { MessageBlock } from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  automaticThreadTitle,
  BACKGROUND_RUN_TRIGGERS,
  BRANCH_CHANGED_ERROR,
  BRANCH_FILE_BYTES_LIMIT,
  BRANCH_FILE_LIMIT,
  BRANCH_MESSAGE_ERROR,
  BRANCH_MESSAGE_LIMIT,
  BRANCH_MESSAGE_SCAN_LIMIT,
  BRANCH_SOURCE_ERROR,
  BRANCH_TOO_LARGE_ERROR,
  BRANCH_WHILE_WORKING_ERROR,
  blockArtifactIds,
  branchConversationTitle,
  branchFileNoncePrefix,
  branchThreadKey,
  branchTitleBase,
  isUserProgressClientNonce,
  messageReaction,
  THREAD_BEING_DELETED_ERROR,
  taskThreadKind,
  USER_PROGRESS_CLIENT_NONCE_PREFIX,
  withCopiedArtifacts,
} from "@mycellios/core";
import { Prisma, type PrismaClient } from "./client.js";
import { isPartialReplyClientNonce, partialReplyClientNonce } from "./messages.js";
import { createRowId } from "./row-id.js";
import { withTransactionRetry } from "./transaction-retry.js";

/**
 * "Branch in new conversation": a finished turn of a Mico's main chat or side conversation is
 * copied into a new conversation of the same Mico, owner and Space. Messages get new ids, the
 * files they show are copied, and nothing that belongs to the source's execution comes along:
 * no runs, usage, costs, effects, events, reactions, pins, queued messages or read marks.
 * Encrypted content is read through the client and written again, so it is sealed under the
 * same Space key and bound to its new row and thread.
 */

type Scope = { spaceId: string; userId: string };
type Db = PrismaClient | Prisma.TransactionClient;

export type ConversationBranchErrorCode =
  | "not_found"
  | "busy"
  | "message"
  | "source"
  | "too_large"
  | "changed"
  | "deleting";

/** A refused branch. Routes map the code to a status and show the message. */
export class ConversationBranchError extends Error {
  constructor(
    readonly code: ConversationBranchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationBranchError";
  }
}

/** Keeps the rows the source's transcript shows (the API passes its own transcript rule). */
export type BranchMessageFilter = <T extends { runId: string | null; blocks: Prisma.JsonValue }>(
  db: Db,
  rows: T[],
) => Promise<T[]>;

export interface ConversationBranchInput {
  botId: string;
  /** A side conversation of the Mico; absent for its main chat. */
  sourceThreadId?: string;
  /** A Mico message of the finished turn the copy ends with. */
  messageId: string;
  visible: BranchMessageFilter;
}

export interface BranchFileToCopy {
  id: string;
  storageKey: string;
  botId: string | null;
  name: string;
  description: string | null;
  mimeType: string;
  size: number;
  hash: string;
}

export interface ConversationBranchResult {
  threadId: string;
  title: string;
  replayed: boolean;
}

interface SourceThread {
  id: string;
  botId: string | null;
  taskBotId: string | null;
  projectKey: string | null;
  taskKey: string | null;
  title: string | null;
  startedBy: string | null;
  deleteAfter: Date | null;
  contextStartSeq: number;
}

interface CopiedRow {
  id: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
  botId: string | null;
  replyToMessageId: string | null;
  replyQuote: string | null;
  runId: string | null;
  clientNonce: string | null;
  createdAt: Date;
}

const ACTIVE = Prisma.join([...ACTIVE_RUN_STATUSES]);
const BACKGROUND = Prisma.join([...BACKGROUND_RUN_TRIGGERS]);
const TX_OPTIONS = { maxWait: 5_000, timeout: 60_000 };

const blocksOf = (value: Prisma.JsonValue): MessageBlock[] =>
  Array.isArray(value) ? (value as unknown as MessageBlock[]) : [];

/** The Mico's main chat or one of its side conversations, for this owner and Space only. */
async function readSourceThread(
  db: Db,
  scope: Scope,
  input: ConversationBranchInput,
  lock: boolean,
) {
  const [bot] = await db.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM bots
    WHERE id = ${input.botId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId} AND "archivedAt" IS NULL`;
  if (!bot) throw new ConversationBranchError("not_found", "This conversation was not found.");
  const which = input.sourceThreadId
    ? Prisma.sql`id = ${input.sourceThreadId} AND "taskBotId" = ${input.botId}`
    : Prisma.sql`"botId" = ${input.botId}`;
  const [source] = await db.$queryRaw<SourceThread[]>`
    SELECT id, "botId", "taskBotId", "projectKey", "taskKey", title, "startedBy", "deleteAfter", "contextStartSeq"
    FROM threads
    WHERE ${which} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
    ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`;
  if (!source) throw new ConversationBranchError("not_found", "This conversation was not found.");
  if (source.deleteAfter) throw new ConversationBranchError("deleting", THREAD_BEING_DELETED_ERROR);
  const main = !input.sourceThreadId;
  if (!main) {
    // Project conversations keep their own worktree and app conversations stay with the app.
    const kind = taskThreadKind(source);
    if (kind === "project" || kind === "other")
      throw new ConversationBranchError("source", BRANCH_SOURCE_ERROR);
    const [app] = await db.$queryRaw<Array<{ found: number }>>`
      SELECT 1 AS found FROM hosted_web_agents WHERE "threadId" = ${source.id} LIMIT 1`;
    if (app) throw new ConversationBranchError("source", BRANCH_SOURCE_ERROR);
  }
  return { ...source, main };
}

/**
 * What a branch would copy: the source, the turn's end, the visible messages of the context
 * window that ends there (at most the newest BRANCH_MESSAGE_LIMIT) and the files they show.
 */
async function readBranchSource(
  db: Db,
  scope: Scope,
  input: ConversationBranchInput,
  lock: boolean,
) {
  const source = await readSourceThread(db, scope, input, lock);
  const [work] = await db.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM runs
    WHERE "threadId" = ${source.id} AND status IN (${ACTIVE}) AND "trigger" NOT IN (${BACKGROUND})`;
  if (work?.count) throw new ConversationBranchError("busy", BRANCH_WHILE_WORKING_ERROR);
  const message = await db.message.findFirst({
    where: { id: input.messageId, threadId: source.id },
    select: { id: true, seq: true, role: true, runId: true },
  });
  if (message?.role !== "bot") throw new ConversationBranchError("message", BRANCH_MESSAGE_ERROR);
  // The copy ends where the message's turn ends.
  let cut = message.seq;
  if (message.runId) {
    const run = await db.run.findFirst({ where: { id: message.runId }, select: { status: true } });
    if (run && (ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
      throw new ConversationBranchError("busy", BRANCH_WHILE_WORKING_ERROR);
    const [last] = await db.$queryRaw<Array<{ seq: number | null }>>`
      SELECT max(seq)::int AS seq FROM messages WHERE "threadId" = ${source.id} AND "runId" = ${message.runId}`;
    cut = Math.max(cut, last?.seq ?? cut);
  }
  // The copy starts where the context the turn belonged to started: after the last New chat
  // divider before it, or at the current context start when the turn is in it.
  const [reset] = await db.$queryRaw<Array<{ seq: number | null }>>`
    SELECT max(seq)::int AS seq FROM messages
    WHERE "threadId" = ${source.id} AND role = 'system' AND seq <= ${cut}
      AND blocks @> '[{"kind":"context_reset"}]'::jsonb`;
  let start = reset?.seq == null ? 0 : reset.seq + 1;
  if (cut >= source.contextStartSeq) start = Math.max(start, source.contextStartSeq);
  const scanned = await db.message.findMany({
    where: {
      threadId: source.id,
      seq: { gte: start, lte: cut },
      // Messages still waiting in the queue were never part of a turn.
      NOT: {
        steeringMessages: {
          some: { originTrigger: { in: ["queued_user", "agent_task"] }, claimedAt: null },
        },
      },
    },
    orderBy: { seq: "desc" },
    take: BRANCH_MESSAGE_SCAN_LIMIT,
    select: {
      id: true,
      seq: true,
      role: true,
      blocks: true,
      botId: true,
      replyToMessageId: true,
      replyQuote: true,
      runId: true,
      clientNonce: true,
      createdAt: true,
    },
  });
  scanned.reverse();
  // Reactions belong to the source; so does what its transcript hides.
  const shown = (await input.visible(db, scanned as CopiedRow[])).filter(
    (row) =>
      !messageReaction({
        role: row.role,
        blocks: blocksOf(row.blocks),
        replyToMessageId: row.replyToMessageId,
      }),
  );
  const copied = shown.slice(-BRANCH_MESSAGE_LIMIT);
  const truncated = scanned.length >= BRANCH_MESSAGE_SCAN_LIMIT || copied.length < shown.length;
  const artifactIds = [...new Set(copied.flatMap((row) => blockArtifactIds(blocksOf(row.blocks))))];
  const files: BranchFileToCopy[] = artifactIds.length
    ? await db.artifact.findMany({
        where: { id: { in: artifactIds }, spaceId: scope.spaceId, userId: scope.userId },
        select: {
          id: true,
          storageKey: true,
          botId: true,
          name: true,
          description: true,
          mimeType: true,
          size: true,
          hash: true,
        },
        orderBy: { id: "asc" },
      })
    : [];
  const bytes = files.reduce((total, file) => total + file.size, 0);
  if (files.length > BRANCH_FILE_LIMIT || bytes > BRANCH_FILE_BYTES_LIMIT)
    throw new ConversationBranchError("too_large", BRANCH_TOO_LARGE_ERROR);
  return { source, message, cut, start, copied, truncated, files };
}

/** The branch an earlier request with this id made, if any. */
export async function findConversationBranch(
  db: Db,
  scope: Scope,
  input: { botId: string; requestId: string },
): Promise<ConversationBranchResult | null> {
  const row = await db.thread.findFirst({
    where: {
      spaceId: scope.spaceId,
      userId: scope.userId,
      taskKey: branchThreadKey(input.botId, input.requestId),
    },
    select: { id: true, title: true, taskBotId: true, startedBy: true },
  });
  if (!row) return null;
  if (row.taskBotId !== input.botId || row.startedBy !== "branch")
    throw new ConversationBranchError("source", BRANCH_SOURCE_ERROR);
  return { threadId: row.id, title: row.title ?? "", replayed: true };
}

/**
 * Checks that the turn can be branched and lists the files the copy needs, without changing
 * anything. The caller copies those files' bytes before it creates the branch.
 */
export async function planConversationBranch(
  prisma: PrismaClient,
  scope: Scope,
  input: ConversationBranchInput,
): Promise<{ files: BranchFileToCopy[] }> {
  const plan = await readBranchSource(prisma, scope, input, false);
  return { files: plan.files };
}

function copiedNonce(nonce: string | null, id: string): string | null {
  // Only the markers the transcript reads come along, renamed so no lookup finds the source.
  if (isUserProgressClientNonce(nonce)) return `${USER_PROGRESS_CLIENT_NONCE_PREFIX}branch:${id}`;
  if (isPartialReplyClientNonce(nonce)) return partialReplyClientNonce(`branch:${id}`);
  return null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Creates the branch under the source's thread lock (the lock sends take, so no turn can start
 * while it copies). `files` maps each source artifact to the storage key of its copied bytes,
 * or to null when the source had already lost them (the copy then shows the same missing
 * file). A file the copy needs and that is not in the map means the source changed meanwhile.
 * A retry with the same request id returns the branch it already made.
 */
export async function createConversationBranch(
  prisma: PrismaClient,
  scope: Scope,
  input: ConversationBranchInput & {
    requestId: string;
    files: ReadonlyMap<string, { storageKey: string } | null>;
    now?: Date;
  },
): Promise<ConversationBranchResult> {
  const taskKey = branchThreadKey(input.botId, input.requestId);
  try {
    return await withTransactionRetry(() =>
      prisma.$transaction(async (tx) => {
        const existing = await findConversationBranch(tx, scope, input);
        if (existing) return existing;
        const plan = await readBranchSource(tx, scope, input, true);
        if (plan.files.some((file) => !input.files.has(file.id)))
          throw new ConversationBranchError("changed", BRANCH_CHANGED_ERROR);
        const { source, copied } = plan;
        const now = input.now ?? new Date();
        // The last message the person wrote that has words or a file name to go by.
        const lastUser = [...copied]
          .reverse()
          .find((row) => row.role === "user" && automaticThreadTitle(blocksOf(row.blocks)));
        const base = source.main
          ? ""
          : branchTitleBase((source.title ?? "").trim(), source.startedBy === "branch");
        const siblings = base
          ? await tx.$queryRaw<Array<{ title: string }>>`
              SELECT title FROM threads
              WHERE "taskBotId" = ${input.botId} AND "spaceId" = ${scope.spaceId} AND "userId" = ${scope.userId}
                AND title IS NOT NULL AND starts_with(title, ${`${base} #`})`
          : [];
        const title = branchConversationTitle({
          sourceTitle: source.title,
          sourceIsMainChat: source.main,
          sourceIsBranch: source.startedBy === "branch",
          existingTitles: siblings.map((row) => row.title),
          lastUserBlocks: lastUser ? blocksOf(lastUser.blocks) : null,
        });
        // A compacted summary comes along only when it ends inside the copy, never after it.
        const compaction = await tx.thread.findUnique({
          where: { id: source.id },
          select: { historyCompactionSummary: true, historyCompactedUpToSeq: true },
        });
        const upTo = compaction?.historyCompactedUpToSeq;
        const first = copied[0];
        const summary =
          compaction?.historyCompactionSummary?.trim() &&
          upTo != null &&
          upTo <= plan.cut &&
          upTo >= plan.start - 1 &&
          (!plan.truncated || (first && upTo >= first.seq - 1))
            ? compaction.historyCompactionSummary
            : null;
        const summarizedThrough = summary
          ? copied.reduce((last, row, index) => (row.seq <= upTo! ? index : last), -1)
          : null;

        const threadId = createRowId();
        const markerSeq = copied.length;
        // The select names the Space and owner, so the content encryption knows where the
        // messages below belong before this transaction commits.
        await tx.thread.create({
          data: {
            id: threadId,
            spaceId: scope.spaceId,
            userId: scope.userId,
            taskBotId: input.botId,
            projectKey: `mico:${input.botId}`,
            taskKey,
            title,
            titleSource: "auto",
            startedBy: "branch",
            branchedFromThreadId: source.id,
            branchedFromMessageId: plan.message.id,
            nextMessageSeq: markerSeq + 1,
            // The person has read the copy up to its end.
            lastReadSeq: markerSeq,
            unread: false,
            ...(summary
              ? { historyCompactionSummary: summary, historyCompactedUpToSeq: summarizedThrough }
              : {}),
          },
          select: { id: true, spaceId: true, userId: true },
        });

        const artifactCopies = new Map<string, string>();
        const fileRows = plan.files.flatMap((file) => {
          const copy = input.files.get(file.id);
          if (!copy) return [];
          const id = createRowId();
          artifactCopies.set(file.id, id);
          return [
            {
              id,
              spaceId: scope.spaceId,
              userId: scope.userId,
              botId: file.botId,
              name: file.name,
              description: file.description,
              mimeType: file.mimeType,
              size: file.size,
              hash: file.hash,
              storageKey: copy.storageKey,
              version: 1,
              // Marks the copy as this branch's, for its delete and for version lookups.
              clientNonce: `${branchFileNoncePrefix(threadId)}${file.id}`,
            },
          ];
        });
        if (fileRows.length) await tx.artifact.createMany({ data: fileRows });

        const messageIds = new Map(copied.map((row) => [row.id, createRowId()]));
        const rows: Prisma.MessageCreateManyInput[] = copied.map((row, index) => {
          const id = messageIds.get(row.id)!;
          return {
            id,
            threadId,
            seq: index,
            role: row.role,
            blocks: withCopiedArtifacts(
              blocksOf(row.blocks),
              artifactCopies,
            ) as unknown as Prisma.InputJsonValue,
            botId: row.botId,
            replyToMessageId: row.replyToMessageId
              ? (messageIds.get(row.replyToMessageId) ?? null)
              : null,
            replyQuote: row.replyQuote,
            clientNonce: copiedNonce(row.clientNonce, id),
            createdAt: row.createdAt,
          };
        });
        const origin: MessageBlock = {
          kind: "branch_origin",
          threadId: source.id,
          messageId: plan.message.id,
          ...(source.main ? { main: true as const } : {}),
          title: source.main
            ? ""
            : Array.from(source.title ?? "")
                .slice(0, 240)
                .join(""),
        };
        rows.push({
          id: createRowId(),
          threadId,
          seq: markerSeq,
          role: "system",
          botId: input.botId,
          blocks: [origin] as unknown as Prisma.InputJsonValue,
          createdAt: now,
        });
        await tx.message.createMany({ data: rows });
        return { threadId, title, replayed: false };
      }, TX_OPTIONS),
    );
  } catch (error) {
    // Two requests with the same id raced: the other one made the branch.
    if (isUniqueViolation(error)) {
      const existing = await findConversationBranch(prisma, scope, input);
      if (existing) return existing;
    }
    throw error;
  }
}
