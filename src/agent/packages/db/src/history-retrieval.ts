import { createHash } from "node:crypto";
import type { HistoryReadInput, HistorySearchInput } from "@mycellios/contracts";
import {
  ACTIVE_RUN_STATUSES,
  BACKGROUND_RUN_TRIGGERS,
  deriveThreadState,
  HISTORY_REPLY_PREVIEW_CHARACTERS,
  HISTORY_REQUEST_PREVIEW_CHARACTERS,
  HISTORY_RESULT_LIMIT,
  HISTORY_RESULT_MAX,
  HISTORY_SIDE_CONVERSATIONS_SEARCHED,
  taskThreadKind,
  threadStartedByForKind,
} from "@mycellios/core";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { searchTerms } from "./content-crypto.js";
import { contentEncryptionOf, INDEXED_MESSAGE, UNINDEXED_MESSAGE } from "./content-encryption.js";
import { historyMessageText } from "./history-text.js";

export { historyMessageText };

/** Only the executor supplies scope; tool arguments cannot widen it. */
export interface HistoryScope {
  spaceId: string;
  userId: string;
  threadId: string;
  botId: string;
  channelId?: string;
  /** Server-captured history boundary. Search excludes the active request and later messages. */
  searchBeforeSeq?: number;
}
interface HistoryRow {
  id: string;
  threadId?: string;
  seq: number;
  role: string;
  runId: string | null;
  replyToMessageId: string | null;
  createdAt: Date;
  blocks: Prisma.JsonValue;
  groupId?: string | null;
  indexed?: boolean;
}
/** Bounds the scan when blind-index collisions keep producing false candidates. */
const MAX_SEARCH_SCANS = 20;
// Bound complete JSON pages, including cursors. Current retains Pi's legacy 12k
// result clipping; newer strategies preserve structured results within their context budget.
const MAX_RESPONSE_BYTES = 10_000;
const LINK_PAGE_SIZE = 5;
function bounded<T extends { messages: ReturnType<typeof reference>[] }>(response: T): T {
  const refs = [...response.messages];
  if ("runs" in response) {
    const runs = response.runs as Array<{
      outcomes: ReturnType<typeof reference>[];
    }>;
    refs.push(...runs.flatMap((run) => run.outcomes));
  }
  while (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_RESPONSE_BYTES) {
    const longest = refs.reduce<ReturnType<typeof reference> | undefined>(
      (best, ref) => (!best || ref.text.length > best.text.length ? ref : best),
      undefined,
    );
    if (!longest || longest.text.length < 2)
      throw new Error("History metadata exceeds response budget");
    longest.text = longest.text.slice(0, Math.floor(longest.text.length / 2));
    longest.truncated = true;
    longest.nextTextOffset = longest.textOffset + longest.text.length;
  }
  return response;
}
const searchableText = Prisma.sql`jsonb_path_query_array(m.blocks,
  '$[*] ? (@.kind == "text" || @.kind == "channel_message" || @.kind == "bot_message_received" || @.kind == "bot_message_sent" || @.kind == "handoff").text')::text || jsonb_path_query_array(m.blocks, '$[*] ? (@.kind == "subagent").task')::text || jsonb_path_query_array(m.blocks, '$[*] ? (@.kind == "subagent").result')::text`;
const columns = Prisma.sql`m.id, m.seq, m.role, m."runId", m."replyToMessageId", m."createdAt", m.blocks, m."threadId", t."groupId" AS "groupId"`;

/**
 * The run's own thread only: the Mico's main chat, one of its side threads (a task
 * conversation, routine or delegated work, linked by taskBotId), or a group it belongs to.
 * Owner, Space and an unarchived owned Mico fence every branch.
 */
function visible(scope: HistoryScope): Prisma.Sql {
  const channel = scope.channelId;
  return Prisma.sql`
    t.id = ${scope.threadId} AND t."spaceId" = ${scope.spaceId}
    AND m.seq >= t."contextStartSeq"
    AND t."userId" = ${scope.userId}
    AND (t."botId" = ${scope.botId}
    OR (t."botId" IS NULL AND t."groupId" IS NULL AND t."taskBotId" = ${scope.botId})
    OR (t."botId" IS NULL AND EXISTS (
      SELECT 1 FROM chat_groups g JOIN chat_group_members member ON member."groupId" = g.id
      WHERE g.id = t."groupId" AND g."spaceId" = ${scope.spaceId} AND g."userId" = ${scope.userId}
        AND g."archivedAt" IS NULL AND member."botId" = ${scope.botId}
    )))
    AND EXISTS (SELECT 1 FROM bots b WHERE b.id = ${scope.botId}
      AND b."spaceId" = ${scope.spaceId} AND b."userId" = ${scope.userId}
      AND b."archivedAt" IS NULL)
    ${
      channel
        ? Prisma.sql`AND (
      (m.role = 'user' AND m.blocks @> ${JSON.stringify([{ kind: "channel_message", channelId: channel }])}::jsonb)
      OR (m.role = 'bot' AND EXISTS (
        SELECT 1 FROM runs r JOIN messages source ON source.id = r."sourceMessageId"
        WHERE r.id = m."runId" AND r."threadId" = t.id
          AND r."spaceId" = ${scope.spaceId} AND r."userId" = ${scope.userId}
          AND r."botId" = ${scope.botId} AND source."threadId" = t.id
          AND source.blocks @> ${JSON.stringify([{ kind: "channel_message", channelId: channel }])}::jsonb
      )))`
        : Prisma.empty
    }
  `;
}
/** Raw reads bypass the client extension, so decrypt here. */
async function messageRows(prisma: PrismaClient, sql: Prisma.Sql): Promise<HistoryRow[]> {
  const rows = await prisma.$queryRaw<HistoryRow[]>(sql);
  return (await contentEncryptionOf(prisma)?.openRows("Message", rows)) ?? rows;
}

/**
 * Encrypted rows match on blind-index word tokens (one token list per key
 * version); rows not yet encrypted keep matching through the full-text index.
 */
async function historyMatch(
  prisma: PrismaClient,
  spaceId: string,
  query: string,
): Promise<Prisma.Sql> {
  const fullText = Prisma.sql`to_tsvector('simple', ${searchableText}) @@ plainto_tsquery('simple', ${query})`;
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) return fullText;
  const tokenSets = (await encryption.messageSearchTokens(spaceId, query, "word")).filter(
    (tokens) => tokens.length,
  );
  const encrypted = tokenSets.map((tokens) => Prisma.sql`m."searchTokens" @> ${tokens}::int[]`);
  return Prisma.sql`(${Prisma.join([...encrypted, Prisma.sql`(${UNINDEXED_MESSAGE} AND ${fullText})`], " OR ")})`;
}
function pageSize(value = 10): number {
  if (!Number.isInteger(value) || value < 1)
    throw new Error("History limit must be a positive integer");
  return Math.min(value, 20);
}
function date(value: string | undefined): Date | undefined {
  if (value === undefined) return;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid history date");
  return parsed;
}
function reference(row: HistoryRow, query = "", maxLength = 800, textOffset = 0) {
  const text = historyMessageText(row.blocks);
  const matchedTerm =
    query && !text.toLowerCase().includes(query.toLowerCase())
      ? (query.split(/\s+/).find((term) => text.toLowerCase().includes(term.toLowerCase())) ??
        query)
      : query;
  if (query) textOffset = Math.max(0, text.toLowerCase().indexOf(matchedTerm.toLowerCase()) - 40);
  return {
    messageId: row.id,
    seq: row.seq,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    runId: row.runId,
    replyToMessageId: row.replyToMessageId,
    text: text.slice(textOffset, textOffset + maxLength),
    textOffset,
    nextTextOffset: textOffset + maxLength < text.length ? textOffset + maxLength : null,
    truncated: textOffset > 0 || textOffset + maxLength < text.length,
  };
}

function resultLimit(value: number | undefined) {
  return Math.min(pageSize(value ?? HISTORY_RESULT_LIMIT), HISTORY_RESULT_MAX);
}

/**
 * Blind-index (or full-text) search in one conversation, descending sequence cursor, five
 * excerpts by default and at most ten. A taskId in the input is kept in nextSearch, so the
 * continuation stays in that conversation.
 */
export async function searchHistory(
  prisma: PrismaClient,
  scope: HistoryScope,
  input: HistorySearchInput,
) {
  const query = input.query?.trim() ?? "";
  if (!query || query.length > 500)
    throw new Error("History query must contain 1 to 500 characters");
  const limit = resultLimit(input.limit);
  const before = date(input.before);
  const after = date(input.after);
  if (
    input.beforeSeq !== undefined &&
    (!Number.isInteger(input.beforeSeq) || input.beforeSeq < 0)
  ) {
    throw new Error("Invalid history cursor");
  }
  if (
    scope.searchBeforeSeq !== undefined &&
    (!Number.isInteger(scope.searchBeforeSeq) || scope.searchBeforeSeq < 0)
  )
    throw new Error("Invalid history search boundary");
  const beforeSeq = Math.min(
    input.beforeSeq ?? Number.POSITIVE_INFINITY,
    scope.searchBeforeSeq ?? Number.POSITIVE_INFINITY,
  );
  const match = await historyMatch(prisma, scope.spaceId, query);
  // Blind-index tokens are 32-bit and share the array with prefix tokens, so an
  // indexed candidate is kept only if its decrypted text has every query word.
  // False candidates are skipped and the scan continues, so pages stay full.
  const words = searchTerms(query);
  const indexed = contentEncryptionOf(prisma) ? INDEXED_MESSAGE : Prisma.sql`false`;
  const rows: HistoryRow[] = [];
  let cursor = beforeSeq;
  // Set when the scan budget runs out with candidates left: the page continues from there.
  let unscanned = false;
  for (let scans = 0; rows.length <= limit; scans += 1) {
    if (scans === MAX_SEARCH_SCANS) {
      unscanned = true;
      break;
    }
    const batch = await messageRows(
      prisma,
      Prisma.sql`
    SELECT ${columns}, ${indexed} AS indexed
    FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE ${visible(scope)}
      AND ${match}
      ${before ? Prisma.sql`AND m."createdAt" < ${before}` : Prisma.empty}
      ${after ? Prisma.sql`AND m."createdAt" >= ${after}` : Prisma.empty}
      ${Number.isFinite(cursor) ? Prisma.sql`AND m.seq < ${cursor}` : Prisma.empty}
    ORDER BY m.seq DESC LIMIT ${limit + 1}
  `,
    );
    for (const row of batch) {
      if (!row.indexed) rows.push(row);
      else {
        const text = new Set(searchTerms(historyMessageText(row.blocks)));
        if (words.every((word) => text.has(word))) rows.push(row);
      }
    }
    if (batch.length <= limit) break;
    cursor = batch.at(-1)!.seq;
  }
  const page = rows.slice(0, limit);
  const nextBeforeSeq =
    rows.length > limit ? page.at(-1)!.seq : unscanned ? (cursor as number) : null;
  return bounded({
    untrusted: true as const,
    query,
    coverage: {
      scope: "requested_query_and_range" as const,
      status: nextBeforeSeq === null ? ("exhausted" as const) : ("partial" as const),
    },
    messages: page.map((row) => reference(row, query)),
    nextBeforeSeq,
    nextSearch:
      nextBeforeSeq === null
        ? null
        : {
            query,
            beforeSeq: nextBeforeSeq,
            limit,
            ...(input.after !== undefined ? { after: input.after } : {}),
            ...(input.before !== undefined ? { before: input.before } : {}),
            ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
          },
  });
}

/** The Mico and owner a cross-conversation read is fenced to; only the executor supplies it. */
export interface HistoryFence {
  spaceId: string;
  userId: string;
  botId: string;
}

/**
 * One of the Mico's own conversations: its main chat or one of its side conversations (opened
 * by the person, by the Mico, a routine or delegated work), for this owner and Space, with an
 * unarchived owned Mico. Groups, outside messaging chats and conversations being deleted are not.
 */
function micoConversation(fence: HistoryFence): Prisma.Sql {
  return Prisma.sql`
    t."spaceId" = ${fence.spaceId} AND t."userId" = ${fence.userId}
    AND t."groupId" IS NULL AND t."externalConversationId" IS NULL AND t."deleteAfter" IS NULL
    AND (t."botId" = ${fence.botId} OR (t."botId" IS NULL AND t."taskBotId" = ${fence.botId}))
    AND EXISTS (SELECT 1 FROM bots b WHERE b.id = ${fence.botId}
      AND b."spaceId" = ${fence.spaceId} AND b."userId" = ${fence.userId} AND b."archivedAt" IS NULL)`;
}

/** True when the thread is one of this Mico's own conversations (see micoConversation). */
export async function isMicoConversation(
  prisma: Pick<PrismaClient, "$queryRaw">,
  fence: HistoryFence,
  threadId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t.id FROM threads t WHERE t.id = ${threadId} AND ${micoConversation(fence)}`;
  return rows.length > 0;
}

/** The conversation a message of this Mico belongs to, when it is one of its own. */
export async function micoConversationOfMessage(
  prisma: Pick<PrismaClient, "$queryRaw">,
  fence: HistoryFence,
  messageId: string,
): Promise<string | null> {
  const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT t.id FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE m.id = ${messageId} AND m.seq >= t."contextStartSeq" AND ${micoConversation(fence)}`;
  return row?.id ?? null;
}

interface ConversationRow {
  id: string;
  botId: string | null;
  taskBotId: string | null;
  projectKey: string | null;
  taskKey: string | null;
  title: string | null;
  startedBy: string | null;
  outcome: string | null;
  archivedAt: Date | null;
  activityAt: Date;
  /** activityAt in epoch milliseconds, computed by the database for the cursor. */
  activityMs?: number;
  activeStatuses: string[] | null;
}

const ACTIVE = Prisma.join([...ACTIVE_RUN_STATUSES]);
const BACKGROUND = Prisma.join([...BACKGROUND_RUN_TRIGGERS]);
const conversationColumns = Prisma.sql`t.id, t."botId", t."taskBotId", t."projectKey", t."taskKey", t.title,
  t."startedBy", t.outcome, t."archivedAt",
  GREATEST(t."createdAt", COALESCE(last."createdAt", t."createdAt")) AS "activityAt"`;
const lastMessage = Prisma.sql`LEFT JOIN LATERAL (
    SELECT "createdAt" FROM messages WHERE "threadId" = t.id ORDER BY seq DESC LIMIT 1
  ) last ON true`;

function conversationLabel(row: Pick<ConversationRow, "botId" | "taskBotId" | "projectKey" | "taskKey" | "title">) {
  const kind = row.botId ? ("main" as const) : taskThreadKind(row);
  return { kind, title: row.botId ? "Main chat" : row.title?.trim() || "Untitled conversation" };
}

// The cursor holds the last activity in epoch milliseconds as the database computes it, so
// it compares the same way whatever the column type or the session time zone.
function encodeCursor(row: ConversationRow) {
  return `${row.activityMs ?? row.activityAt.getTime()}~${row.id}`;
}
function decodeCursor(cursor: string | undefined) {
  if (cursor === undefined) return undefined;
  const at = cursor.indexOf("~");
  const ms = Number(cursor.slice(0, at));
  const id = cursor.slice(at + 1);
  if (at < 1 || !id || !Number.isSafeInteger(ms) || ms < 0) throw new Error("Invalid history cursor");
  return { ms, id };
}
const activityMs = Prisma.sql`round(extract(epoch FROM c."activityAt") * 1000)::float8`;
function preview(text: string, characters: number) {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > characters ? `${chars.slice(0, characters).join("")}…` : chars.join("");
}

/**
 * The Mico's main chat and its side conversations (open and archived), newest activity first,
 * with kind, state, outcome and the latest request and reply after the New chat boundary.
 * Five per page by default, at most ten; nextCursor continues the listing.
 */
export async function listHistoryConversations(
  prisma: PrismaClient,
  fence: HistoryFence & { currentThreadId: string },
  input: Pick<HistorySearchInput, "after" | "cursor" | "limit">,
) {
  const limit = resultLimit(input.limit);
  const after = date(input.after);
  const cursor = decodeCursor(input.cursor);
  const rows = await prisma.$queryRaw<ConversationRow[]>`
    SELECT c.*, ${activityMs} AS "activityMs" FROM (
      SELECT ${conversationColumns}, active.statuses AS "activeStatuses"
      FROM threads t
      ${lastMessage}
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT r.status) AS statuses FROM runs r
        WHERE r."threadId" = t.id AND r.status IN (${ACTIVE})
          AND (r."trigger" NOT IN (${BACKGROUND}) OR r.status IN ('waiting_input', 'waiting_takeover'))
      ) active ON true
      WHERE ${micoConversation(fence)}
    ) c
    WHERE true
      ${after ? Prisma.sql`AND c."activityAt" >= ${after}` : Prisma.empty}
      ${cursor ? Prisma.sql`AND (${activityMs}, c.id) < (${cursor.ms}::float8, ${cursor.id}::text)` : Prisma.empty}
    ORDER BY c."activityAt" DESC, c.id DESC LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  const latest = page.length
    ? await messageRows(
        prisma,
        Prisma.sql`
    SELECT ${columns} FROM threads t
    CROSS JOIN LATERAL (
      (SELECT * FROM messages u WHERE u."threadId" = t.id AND u.role = 'user' AND u.seq >= t."contextStartSeq"
        ORDER BY u.seq DESC LIMIT 1)
      UNION ALL
      (SELECT * FROM messages b WHERE b."threadId" = t.id AND b.role = 'bot' AND b.seq >= t."contextStartSeq"
        ORDER BY b.seq DESC LIMIT 1)
    ) m
    WHERE t.id IN (${Prisma.join(page.map((row) => row.id))}) AND ${micoConversation(fence)}`,
      )
    : [];
  const text = (threadId: string, role: string, characters: number) => {
    const row = latest.find((message) => message.threadId === threadId && message.role === role);
    const value = row ? historyMessageText(row.blocks) : "";
    return value ? preview(value, characters) : null;
  };
  const conversations = page.map((row) => {
    const { kind, title } = conversationLabel(row);
    return {
      taskId: row.id,
      kind,
      title,
      current: row.id === fence.currentThreadId,
      archived: Boolean(row.archivedAt),
      state: deriveThreadState({ archivedAt: row.archivedAt, activeRunStatuses: row.activeStatuses ?? [] }),
      outcome: row.outcome,
      startedBy: kind === "main" ? null : (row.startedBy ?? threadStartedByForKind(kind)),
      lastActivityAt: row.activityAt.toISOString(),
      lastRequest: text(row.id, "user", HISTORY_REQUEST_PREVIEW_CHARACTERS),
      lastReply: text(row.id, "bot", HISTORY_REPLY_PREVIEW_CHARACTERS),
    };
  });
  const response = {
    untrusted: true as const,
    conversations,
    nextCursor: rows.length > limit ? encodeCursor(page.at(-1)!) : null,
  };
  // Keep the page within the same budget as other history results.
  while (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_RESPONSE_BYTES) {
    const longest = conversations
      .flatMap((item) => [
        { item, field: "lastReply" as const },
        { item, field: "lastRequest" as const },
      ])
      .reduce<{ item: (typeof conversations)[number]; field: "lastReply" | "lastRequest" } | undefined>(
        (best, entry) =>
          (entry.item[entry.field]?.length ?? 0) > (best ? (best.item[best.field]?.length ?? 0) : 0) ? entry : best,
        undefined,
      );
    const value = longest?.item[longest.field];
    if (!longest || !value || value.length < 2) throw new Error("History metadata exceeds response budget");
    longest.item[longest.field] = `${Array.from(value).slice(0, Math.floor(Array.from(value).length / 2)).join("")}…`;
  }
  return response;
}

/**
 * Searches this conversation first, then the Mico's main chat and its newest side conversations,
 * and tags each match with its taskId. Five matches by default, at most ten. Each conversation
 * keeps its own boundary; nextSearch continues the first conversation that has more matches.
 */
export async function searchHistoryAcross(
  prisma: PrismaClient,
  scope: HistoryScope,
  input: HistorySearchInput,
) {
  const query = input.query?.trim() ?? "";
  if (!query || query.length > 500)
    throw new Error("History query must contain 1 to 500 characters");
  const limit = resultLimit(input.limit);
  const fence = { spaceId: scope.spaceId, userId: scope.userId, botId: scope.botId };
  const others = await prisma.$queryRaw<ConversationRow[]>`
    SELECT * FROM (
      SELECT ${conversationColumns}, NULL AS "activeStatuses"
      FROM threads t
      ${lastMessage}
      WHERE ${micoConversation(fence)} AND t.id <> ${scope.threadId}
    ) c
    ORDER BY (c."botId" IS NOT NULL) DESC, c."activityAt" DESC, c.id DESC
    LIMIT ${HISTORY_SIDE_CONVERSATIONS_SEARCHED + 1}`;
  const [current] = await prisma.$queryRaw<ConversationRow[]>`
    SELECT ${conversationColumns}, NULL AS "activeStatuses"
    FROM threads t ${lastMessage}
    WHERE t.id = ${scope.threadId} AND ${micoConversation(fence)}`;
  // A main chat is listed first among the others; keep at most eight side conversations.
  const main = others.filter((row) => row.botId);
  const sides = others.filter((row) => !row.botId).slice(0, HISTORY_SIDE_CONVERSATIONS_SEARCHED);
  const targets = [...(current ? [current] : []), ...main, ...sides];
  const messages: Array<ReturnType<typeof reference> & { taskId: string; conversation: string }> = [];
  const conversations: Array<{
    taskId: string;
    kind: ReturnType<typeof conversationLabel>["kind"];
    title: string;
    current: boolean;
    status: "exhausted" | "partial" | "not_searched";
  }> = [];
  let nextSearch: Record<string, unknown> | null = null;
  for (const target of targets) {
    const label = conversationLabel(target);
    const isCurrent = target.id === scope.threadId;
    const entry = { taskId: target.id, ...label, current: isCurrent };
    if (messages.length >= limit) {
      conversations.push({ ...entry, status: "not_searched" });
      continue;
    }
    const result = await searchHistory(
      prisma,
      isCurrent ? scope : { spaceId: scope.spaceId, userId: scope.userId, botId: scope.botId, threadId: target.id },
      {
        query,
        limit: limit - messages.length,
        ...(input.after !== undefined ? { after: input.after } : {}),
        ...(input.before !== undefined ? { before: input.before } : {}),
        taskId: target.id,
      },
    );
    for (const message of result.messages) messages.push({ ...message, taskId: target.id, conversation: label.title });
    conversations.push({ ...entry, status: result.coverage.status });
    if (!nextSearch && result.nextSearch) nextSearch = result.nextSearch;
  }
  // Older side conversations past the newest eight were not searched.
  const moreConversations = others.filter((row) => !row.botId).length > HISTORY_SIDE_CONVERSATIONS_SEARCHED;
  const exhausted = !moreConversations && conversations.every((item) => item.status === "exhausted");
  return bounded({
    untrusted: true as const,
    query,
    coverage: {
      scope: "this_and_recent_conversations" as const,
      status: exhausted ? ("exhausted" as const) : ("partial" as const),
    },
    messages,
    conversations,
    nextSearch,
    ...(exhausted
      ? {}
      : { note: "Search one conversation with its taskId, or list older ones with search_history without a query." }),
  });
}

/**
 * The newest page of a conversation in scope (default 10, at most 20 messages, oldest first);
 * nextCursor reads the page before it. Same fence as every other history read.
 */
export async function readHistoryPage(
  prisma: PrismaClient,
  scope: HistoryScope,
  input: Pick<HistoryReadInput, "before" | "limit">,
) {
  const limit = pageSize(input.limit);
  if (input.before !== undefined && (!Number.isInteger(input.before) || input.before < 0))
    throw new Error("Invalid history cursor");
  const rows = await messageRows(
    prisma,
    Prisma.sql`
    SELECT ${columns} FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE ${visible(scope)}
      ${input.before !== undefined ? Prisma.sql`AND m.seq < ${input.before}` : Prisma.empty}
    ORDER BY m.seq DESC LIMIT ${limit + 1}
  `,
  );
  const page = rows.slice(0, limit).sort((a, b) => a.seq - b.seq);
  return bounded({
    untrusted: true as const,
    messages: page.map((row) => reference(row, "", 2000)),
    nextCursor: rows.length > limit ? page[0]!.seq : null,
  });
}

/** Anchor authorization and neighbor authorization use the same predicate. */
export async function readHistory(
  prisma: PrismaClient,
  scope: HistoryScope,
  input: Omit<HistoryReadInput, "messageId"> & { messageId: string },
) {
  const limit = Math.min(pageSize(input.limit), 5);
  const direction = input.direction ?? "around";
  if (
    input.textOffset !== undefined &&
    (!Number.isInteger(input.textOffset) || input.textOffset < 0)
  )
    throw new Error("Invalid history text offset");
  if (!["around", "older", "newer"].includes(direction))
    throw new Error("Invalid history direction");
  const anchors = await messageRows(
    prisma,
    Prisma.sql`
    SELECT ${columns} FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE ${visible(scope)} AND m.id = ${input.messageId} LIMIT 1
  `,
  );
  const anchor = anchors[0];
  if (!anchor)
    return {
      untrusted: true as const,
      messages: [],
      runs: [],
      snapshots: [],
      nextRunId: null,
      nextArtifactId: null,
      nextOutcomeSeq: null,
      olderMessageId: null,
      newerMessageId: null,
    };
  const bound =
    direction === "older"
      ? Prisma.sql`m.seq < ${anchor.seq}`
      : direction === "newer"
        ? Prisma.sql`m.seq > ${anchor.seq}`
        : Prisma.sql`m.seq >= ${Math.max(0, anchor.seq - Math.floor(limit / 2))}`;
  const rows =
    input.textOffset !== undefined
      ? [anchor]
      : await messageRows(
          prisma,
          Prisma.sql`
    SELECT ${columns} FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE ${visible(scope)} AND ${bound}
    ORDER BY m.seq ${direction === "older" ? Prisma.sql`DESC` : Prisma.sql`ASC`} LIMIT ${limit}
  `,
        );
  rows.sort((a, b) => a.seq - b.seq);
  const anchoredRunIds = rows.flatMap((row) =>
    row.role === "bot" && row.runId ? [row.runId] : [],
  );
  // Source-less background runs require an authorized surviving output anchor.
  const runRows = await prisma.run.findMany({
    where: {
      spaceId: scope.spaceId,
      userId: scope.userId,
      threadId: scope.threadId,
      ...(anchor.groupId ? {} : { botId: scope.botId }),
      ...(input.linkedRunId
        ? { id: input.linkedRunId }
        : input.runAfterId
          ? { id: { gt: input.runAfterId } }
          : {}),
      ...(scope.channelId
        ? {
            sourceMessage: {
              threadId: scope.threadId,
              role: "user",
              blocks: {
                array_contains: [{ kind: "channel_message", channelId: scope.channelId }],
              },
            },
          }
        : {
            AND: [
              {
                OR: [
                  { sourceMessage: { threadId: scope.threadId } },
                  { sourceMessageId: null, id: { in: anchoredRunIds } },
                ],
              },
            ],
          }),
      OR: [{ sourceMessageId: { in: rows.map((row) => row.id) } }, { id: { in: anchoredRunIds } }],
    },
    select: {
      id: true,
      sourceMessageId: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
    orderBy: { id: "asc" },
    take: LINK_PAGE_SIZE + 1,
  });
  const runs = runRows.slice(0, LINK_PAGE_SIZE);
  const [outcomeRows, artifactRows] = await Promise.all([
    runs.length
      ? messageRows(
          prisma,
          Prisma.sql`
    SELECT ${columns} FROM messages m JOIN threads t ON t.id = m."threadId"
    WHERE ${visible(scope)} AND m.role = 'bot' AND m."runId" IN (${Prisma.join(runs.map((run) => run.id))})
      ${input.outcomeAfterSeq !== undefined ? Prisma.sql`AND m.seq > ${input.outcomeAfterSeq}` : Prisma.empty}
    ORDER BY m.seq ASC LIMIT ${LINK_PAGE_SIZE + 1}
  `,
        )
      : Promise.resolve([]),
    runs.length
      ? prisma.artifact.findMany({
          where: {
            spaceId: scope.spaceId,
            userId: scope.userId,
            ...(anchor.groupId
              ? { groupId: anchor.groupId }
              : { botId: scope.botId, groupId: null }),
            runId: { in: runs.map((run) => run.id) },
            ...(input.artifactAfterId ? { id: { gt: input.artifactAfterId } } : {}),
          },
          select: {
            id: true,
            runId: true,
            name: true,
            mimeType: true,
            size: true,
          },
          take: LINK_PAGE_SIZE + 1,
          orderBy: { id: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const outcomes = outcomeRows.slice(0, LINK_PAGE_SIZE);
  const artifacts = artifactRows.slice(0, LINK_PAGE_SIZE);
  return bounded({
    untrusted: true as const,
    nextRunId: runRows.length > LINK_PAGE_SIZE ? runs.at(-1)!.id : null,
    nextArtifactId: artifactRows.length > LINK_PAGE_SIZE ? artifacts.at(-1)!.id : null,
    nextOutcomeSeq: outcomeRows.length > LINK_PAGE_SIZE ? outcomes.at(-1)!.seq : null,
    messages: rows.map((row) =>
      reference(row, "", 2000, row.id === anchor.id ? (input.textOffset ?? 0) : 0),
    ),
    runs: runs.map((run) => ({
      ...run,
      outcomes: outcomes.filter((row) => row.runId === run.id).map((row) => reference(row)),
      artifacts: artifacts.filter((artifact) => artifact.runId === run.id),
    })),
    snapshots: rows.map((row) => {
      const linkedRuns = runs.filter(
        (run) => run.sourceMessageId === row.id || run.id === row.runId,
      );
      const outcome = outcomes.find((message) =>
        linkedRuns.some((run) => run.id === message.runId),
      );
      return {
        anchorMessageId: row.id,
        fromSeq: row.seq,
        toSeq: row.seq,
        createdAt: row.createdAt.toISOString(),
        version: createHash("sha256").update(JSON.stringify(row.blocks)).digest("hex"),
        topic: reference(row, "", 200).text,
        openRunIds: linkedRuns
          .filter((run) => !["completed", "failed", "cancelled"].includes(run.status))
          .map((run) => run.id),
        outcome: outcome ? reference(outcome, "", 200).text : null,
        source: "original" as const,
      };
    }),
    olderMessageId: rows[0]?.id ?? null,
    newerMessageId: rows.at(-1)?.id ?? null,
  });
}
