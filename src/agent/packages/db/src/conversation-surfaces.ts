import type {
  Actor,
  MessageBlock,
  MicoConversationSummary,
  SideThreadRequest,
  SideThreadRequestKind,
} from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_RUN_TRIGGERS,
  isApprovalAskBlock,
  isSecretAskBlock,
  USER_PROGRESS_CLIENT_NONCE_PREFIX,
  WAITING_ON_USER_RUN_STATUSES,
  WORKING_RUN_STATUSES,
} from "@mycellios/core";
import { Prisma } from "./client.js";
import type { PrismaClient } from "./client.js";

type Scope = Pick<Actor, "userId" | "spaceId">;

const ACTIVE = Prisma.join([...ACTIVE_RUN_STATUSES]);
const WAITING = Prisma.join([...WAITING_ON_USER_RUN_STATUSES]);
const WORKING = Prisma.join([...WORKING_RUN_STATUSES]);
const BACKGROUND = Prisma.join([...BACKGROUND_RUN_TRIGGERS]);
/** Progress notes a Mico writes mid-turn are not replies to count. */
const USER_PROGRESS_PATTERN = `${USER_PROGRESS_CLIENT_NONCE_PREFIX}%`;
/** The main-chat count stops here; the sidebar shows anything above 99 as 99+. */
export const UNREAD_COUNT_LIMIT = 100;
/** At most this many pending requests are mirrored into a main chat at once. */
export const SIDE_THREAD_REQUEST_LIMIT = 20;

/**
 * Open conversations of a Mico as its tabs list them: not archived, not being deleted, and not a
 * development project's session (those live under their project). A Space member's conversation
 * with a shared Mico is theirs to read, answer and mark read, so it never counts or waits here.
 */
const OPEN_SIDE_THREAD = Prisma.sql`t."archivedAt" IS NULL AND t."deleteAfter" IS NULL
  AND (t."projectKey" IS NULL OR t."projectKey" NOT LIKE 'project:%') AND t."memberUserId" IS NULL`;

const count = (value: unknown) => {
  const parsed = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * One line per Mico with open conversations: how many there are, how many have an unread
 * reply, wait for the person (a question, an approval or a takeover) or work. Only metadata
 * is read; messages stay untouched. Micos without open conversations are absent.
 */
export async function micoConversationSummaries(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  botIds: readonly string[],
): Promise<Map<string, MicoConversationSummary>> {
  const summaries = new Map<string, MicoConversationSummary>();
  if (!botIds.length) return summaries;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT t."taskBotId" AS "botId",
      count(*)::int AS open,
      count(*) FILTER (WHERE t.unread)::int AS unread,
      count(*) FILTER (WHERE a.waiting)::int AS waiting,
      count(*) FILTER (WHERE a.working AND NOT a.waiting)::int AS working,
      COALESCE(sum(t."nextEventSeq" + t."nextMessageSeq"), 0)::bigint AS moves
    FROM threads t
    LEFT JOIN LATERAL (
      SELECT COALESCE(bool_or(r.status IN (${WAITING})), false) AS waiting,
        COALESCE(bool_or(r.status IN (${WORKING}) AND r."trigger" NOT IN (${BACKGROUND})), false) AS working
      FROM runs r WHERE r."threadId" = t.id AND r.status IN (${ACTIVE})
    ) a ON true
    WHERE t."userId" = ${userId} AND t."taskBotId" IN (${Prisma.join([...botIds])}) AND ${OPEN_SIDE_THREAD}
    GROUP BY t."taskBotId"`;
  const known = new Set(botIds);
  for (const row of Array.isArray(rows) ? rows : []) {
    const botId = typeof row.botId === "string" ? row.botId : null;
    const open = count(row.open);
    if (!botId || !known.has(botId) || !open) continue;
    const summary = {
      open,
      unread: count(row.unread),
      waiting: count(row.waiting),
      working: count(row.working),
    };
    summaries.set(botId, {
      ...summary,
      revision: `${summary.open}:${summary.unread}:${summary.waiting}:${summary.working}:${count(row.moves)}`,
    });
  }
  return summaries;
}

/**
 * Unread replies per chat: the Mico's messages after both the read cursor and the person's own
 * last message (writing means they caught up), at most UNREAD_COUNT_LIMIT. Pass only chats
 * whose unread flag is on; others count 0.
 */
export async function unreadReplyCounts(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  threadIds: readonly string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!threadIds.length) return counts;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT t.id AS "threadId", c.count
    FROM threads t
    LEFT JOIN LATERAL (
      SELECT seq FROM messages WHERE "threadId" = t.id AND role = 'user' ORDER BY seq DESC LIMIT 1
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS count FROM (
        SELECT 1 FROM messages m
        WHERE m."threadId" = t.id AND m.role = 'bot'
          AND m.seq > GREATEST(t."lastReadSeq", COALESCE(u.seq, -1))
          AND (m."clientNonce" IS NULL OR m."clientNonce" NOT LIKE ${USER_PROGRESS_PATTERN})
        ORDER BY m.seq DESC
        LIMIT ${UNREAD_COUNT_LIMIT}
      ) recent
    ) c ON true
    WHERE t.id IN (${Prisma.join([...threadIds])}) AND t."userId" = ${userId} AND t.unread`;
  const known = new Set(threadIds);
  for (const row of Array.isArray(rows) ? rows : []) {
    const threadId = typeof row.threadId === "string" ? row.threadId : null;
    const value = count(row.count);
    if (threadId && known.has(threadId) && value) counts.set(threadId, Math.min(UNREAD_COUNT_LIMIT, value));
  }
  return counts;
}

/**
 * Marks every chat read at once, in one statement per call so each row moves under its own
 * lock and a reply landing meanwhile keeps its place after the cursor. With `botId`: that
 * Mico's main chat and its open conversations; without: every main chat, group and open
 * conversation of the person in this Space. Archived conversations keep their state.
 */
export async function markAllThreadsRead(
  prisma: Pick<PrismaClient, "$executeRaw">,
  scope: Scope,
  input: { botId?: string } = {},
): Promise<number> {
  // Members' conversations keep their own read state (see OPEN_SIDE_THREAD).
  const target = input.botId
    ? Prisma.sql`(t."botId" = ${input.botId} OR (t."taskBotId" = ${input.botId} AND t."archivedAt" IS NULL AND t."deleteAfter" IS NULL AND t."memberUserId" IS NULL))`
    : Prisma.sql`(t."botId" IS NOT NULL OR t."groupId" IS NOT NULL
        OR (t."taskBotId" IS NOT NULL AND t."archivedAt" IS NULL AND t."deleteAfter" IS NULL AND t."memberUserId" IS NULL))`;
  return prisma.$executeRaw`
    UPDATE threads t SET unread = false, "lastReadSeq" = GREATEST(t."lastReadSeq", t."nextMessageSeq" - 1)
    WHERE t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId} AND ${target}
      AND (t.unread OR t."lastReadSeq" < t."nextMessageSeq" - 1)`;
}

/**
 * Makes the newest reply of a chat unread: the read cursor moves to just before it, so the
 * next open puts the New divider above it. A chat without replies only gets its dot.
 */
export async function markNewestReplyUnread(
  prisma: Pick<PrismaClient, "$executeRaw">,
  scope: Scope,
  threadId: string,
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE threads t SET unread = true, "lastReadSeq" = LEAST(t."lastReadSeq", COALESCE((
      SELECT m.seq - 1 FROM messages m WHERE m."threadId" = t.id AND m.role = 'bot'
      ORDER BY m.seq DESC LIMIT 1), t."lastReadSeq"))
    WHERE t.id = ${threadId} AND t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId}`;
}

type RequestBlock = { kind: string; status?: string; input?: string; approvalEffectId?: string;
  actions?: Array<{ id: string; label: string }>; plan?: unknown; credential?: unknown };

/** What a pending ask asks for; anything that is not one of the special cards is a question. */
export function sideThreadRequestKind(block: RequestBlock): SideThreadRequestKind {
  if (isApprovalAskBlock(block) || block.approvalEffectId) return "approval";
  if (isSecretAskBlock(block) || block.credential) return "secret";
  if (block.plan) return "plan";
  return "question";
}

/**
 * Pending requests of a Mico's open conversations, newest first: each waiting run with its
 * unanswered ask (read through the client so encrypted content is decrypted), or a takeover.
 * A waiting run whose ask is not found still appears, without a block, so the main chat can
 * link to the conversation.
 */
export async function listSideThreadRequests(
  prisma: Pick<PrismaClient, "$queryRaw" | "message">,
  scope: Scope,
  input: { botId: string; limit?: number },
): Promise<SideThreadRequest[]> {
  const waiting = await prisma.$queryRaw<Array<{ threadId: string; title: string | null; runId: string;
    status: string; updatedAt: Date }>>`
    SELECT t.id AS "threadId", t.title, r.id AS "runId", r.status, r."updatedAt"
    FROM threads t
    JOIN runs r ON r."threadId" = t.id AND r.status IN (${WAITING})
    WHERE t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId} AND t."taskBotId" = ${input.botId}
      AND ${OPEN_SIDE_THREAD}
    ORDER BY r."updatedAt" DESC, r.id DESC
    LIMIT ${input.limit ?? SIDE_THREAD_REQUEST_LIMIT}`;
  if (!waiting.length) return [];
  const asking = waiting.filter((row) => row.status === "waiting_input");
  const messages = asking.length
    ? await prisma.message.findMany({
        where: {
          threadId: { in: asking.map((row) => row.threadId) },
          runId: { in: asking.map((row) => row.runId) },
          role: "bot",
        },
        orderBy: { seq: "desc" },
        take: 200,
        select: { id: true, threadId: true, runId: true, blocks: true, createdAt: true },
      })
    : [];
  return waiting.map((row) => {
    const base = { threadId: row.threadId, title: row.title ?? "", runId: row.runId };
    if (row.status === "waiting_takeover") {
      return { ...base, messageId: null, kind: "takeover" as const, block: null, createdAt: row.updatedAt.toISOString() };
    }
    for (const message of messages) {
      if (message.threadId !== row.threadId || message.runId !== row.runId) continue;
      const blocks = Array.isArray(message.blocks) ? (message.blocks as RequestBlock[]) : [];
      const block = [...blocks].reverse().find((item) => item?.kind === "ask" && item.status !== "answered");
      if (!block) continue;
      return {
        ...base,
        messageId: message.id,
        kind: sideThreadRequestKind(block),
        block: block as unknown as MessageBlock,
        createdAt: message.createdAt.toISOString(),
      };
    }
    return { ...base, messageId: null, kind: "question" as const, block: null, createdAt: row.updatedAt.toISOString() };
  });
}

export type RosterConversationSignals = { unreadCount?: number; conversations?: MicoConversationSummary };

/**
 * Sidebar signals for roster rows: the main chat's unread reply count and the summary of each
 * Mico's open conversations. Only fields with something to say are set. A failed read leaves
 * the roster as it was rather than failing the whole list.
 */
export async function rosterConversationSignals(
  prisma: Pick<PrismaClient, "$queryRaw">,
  userId: string,
  rows: ReadonlyArray<{ botId: string; threadId: string; unread: boolean }>,
): Promise<Map<string, RosterConversationSignals>> {
  const signals = new Map<string, RosterConversationSignals>();
  if (!rows.length) return signals;
  try {
    const [summaries, counts] = await Promise.all([
      micoConversationSummaries(prisma, userId, rows.map((row) => row.botId)),
      unreadReplyCounts(prisma, userId, rows.filter((row) => row.unread).map((row) => row.threadId)),
    ]);
    for (const row of rows) {
      const unreadCount = row.unread ? counts.get(row.threadId) : undefined;
      const conversations = summaries.get(row.botId);
      if (unreadCount || conversations)
        signals.set(row.botId, { ...(unreadCount ? { unreadCount } : {}), ...(conversations ? { conversations } : {}) });
    }
  } catch {
    // Counts are a convenience on top of the unread dot, which the roster already carries.
  }
  return signals;
}
