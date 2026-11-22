import type { Actor, MessageBlock, SearchFilter, SearchHit } from "@mycellios/contracts";
import { GROUP_MEMBER_MIN } from "@mycellios/contracts";
import {
  displayName,
  escapeJsonSearchWildcards,
  escapeSearchWildcards,
  extractLinksFromText,
  matchesSearchQuery,
  snippetAroundMatch,
} from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import {
  contentEncryptionOf,
  historyMessageText,
  INDEXED_MESSAGE,
  Prisma,
  UNINDEXED_MESSAGE,
} from "@mycellios/db";
import { withoutPeerRunMessages } from "./thread-message-pages.js";

const SEARCH_LIMIT = 25;
/** Cap name matches so content hits (messages/files/links/routines) keep most of the budget. */
const CONVERSATION_HIT_LIMIT = 5;
/** Recent encrypted messages scanned when no query term is long enough to be indexed. */
const UNINDEXED_SCAN_LIMIT = 200;

/**
 * Encrypted messages match on blind-index prefix tokens, then decrypt and filter
 * in `pushMessageHits`; rows not yet encrypted keep the substring match. Index
 * matches are whole words or word prefixes, so text inside a word only matches
 * on rows that are still plaintext.
 */
async function messageMatch(prisma: PrismaClient, spaceId: string, query: string) {
  const plaintext = Prisma.sql`m.blocks::text ILIKE ${`%${escapeJsonSearchWildcards(query)}%`}`;
  const encryption = contentEncryptionOf(prisma);
  if (!encryption) return { sql: plaintext, limit: SEARCH_LIMIT, pages: 1 };
  const keyTokens = await encryption.messageSearchTokens(spaceId, query, "prefix");
  // No keys: nothing in the space was ever encrypted (encryption off from the start).
  if (!keyTokens.length) return { sql: plaintext, limit: SEARCH_LIMIT, pages: 1 };
  const tokenSets = keyTokens.filter((tokens) => tokens.length);
  if (!tokenSets.length)
    return {
      sql: Prisma.sql`(${INDEXED_MESSAGE} OR ${plaintext})`,
      limit: UNINDEXED_SCAN_LIMIT,
      pages: 1,
    };
  const encrypted = tokenSets.map((tokens) => Prisma.sql`m."searchTokens" @> ${tokens}::int[]`);
  return {
    sql: Prisma.sql`(${Prisma.join([...encrypted, Prisma.sql`(${UNINDEXED_MESSAGE} AND ${plaintext})`], " OR ")})`,
    limit: SEARCH_LIMIT * 4,
    // Candidates can share the query's words without containing the phrase, so
    // keep fetching until results fill or candidates run out, within a bound.
    pages: 5,
  };
}

async function openMessages<T extends { id: string }>(prisma: PrismaClient, rows: T[]) {
  return (await contentEncryptionOf(prisma)?.openRows("Message", rows)) ?? rows;
}

/** A message in one of a Mico's side conversations names it, so a result can open it. */
type FoundMessage = { id: string; seq: number; taskThreadId?: string; conversationTitle?: string };

/** Side conversations shown in search: the Mico's own, not an outside chat or one being deleted. */
const micoThread = Prisma.sql`t."groupId" IS NULL AND t."externalConversationId" IS NULL AND t."deleteAfter" IS NULL`;

function conversationOf(row: { taskThreadId: string | null; threadTitle: string | null }) {
  return row.taskThreadId
    ? { taskThreadId: row.taskThreadId, conversationTitle: row.threadTitle?.trim() || "Untitled conversation" }
    : {};
}

async function findArtifactMessages(
  prisma: PrismaClient,
  actor: Actor,
  artifacts: Array<{ id: string; targetId: string }>,
  target: "bot" | "group",
): Promise<Map<string, FoundMessage>> {
  if (artifacts.length === 0) return new Map();
  // A Mico's file can be in its main chat or one of its side conversations.
  const targetColumn =
    target === "bot"
      ? Prisma.sql`COALESCE(t."botId", t."taskBotId")`
      : Prisma.sql`t."groupId"`;
  const threadScope = target === "bot" ? Prisma.sql`AND ${micoThread}` : Prisma.empty;
  const candidates = Prisma.join(
    artifacts.map(({ id, targetId }) => Prisma.sql`(${id}, ${targetId})`),
  );
  const rows = await prisma.$queryRaw<
    Array<{ artifactId: string; id: string; seq: number; taskThreadId: string | null; threadTitle: string | null }>
  >(
    Prisma.sql`
      SELECT candidate."artifactId", message.id, message.seq, message."taskThreadId", message."threadTitle"
      FROM (VALUES ${candidates}) AS candidate("artifactId", "targetId")
      CROSS JOIN LATERAL (
        SELECT m.id, m.seq, CASE WHEN t."botId" IS NULL THEN t.id END AS "taskThreadId",
          t.title AS "threadTitle"
        FROM messages m
        INNER JOIN threads t ON t.id = m."threadId"
        WHERE t."spaceId" = ${actor.spaceId}
          AND t."userId" = ${actor.userId}
          AND ${targetColumn} = candidate."targetId"
          ${threadScope}
          AND m.blocks::text ILIKE ('%' || candidate."artifactId" || '%')
        ORDER BY m."createdAt" DESC
        LIMIT 1
      ) message
    `,
  );
  return new Map(
    rows.map(({ artifactId, id, seq, ...thread }) => [artifactId, { id, seq, ...conversationOf(thread) }]),
  );
}

export async function querySpaceSearch(
  prisma: PrismaClient,
  actor: Actor,
  q: string,
  filter: SearchFilter = "all",
): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const wants = (kind: Exclude<SearchFilter, "all">) => filter === "all" || filter === kind;
  // One kind at a time fills the whole page with that kind.
  const nameLimit = filter === "all" ? CONVERSATION_HIT_LIMIT : SEARCH_LIMIT;
  // The database side has to match the text the user typed, the way
  // `matchesSearchQuery` does in memory: a `%` or `_` would otherwise widen
  // the match, and a `\` would swallow the character after it.
  const likeQuery = escapeSearchWildcards(query);

  const conversationHits: SearchHit[] = [];
  const contentHits: SearchHit[] = [];
  const seen = new Set<string>();

  function pushInto(bucket: SearchHit[], hit: SearchHit, limit: number) {
    const key = [
      hit.kind,
      hit.botId ?? "",
      hit.groupId ?? "",
      hit.messageId ?? "",
      hit.artifactId ?? "",
      hit.routineId ?? "",
      hit.url ?? "",
    ].join(":");
    if (seen.has(key) || bucket.length >= limit) return;
    seen.add(key);
    bucket.push(hit);
  }

  const bots = !wants("micos") ? [] : await prisma.bot.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      archivedAt: null,
      OR: [
        { name: { contains: likeQuery, mode: "insensitive" } },
        { title: { contains: likeQuery, mode: "insensitive" } },
        { description: { contains: likeQuery, mode: "insensitive" } },
      ],
    },
    take: nameLimit,
  });
  for (const bot of bots) {
    pushInto(
      conversationHits,
      {
        kind: "conversation",
        botId: bot.id,
        botName: bot.name,
        title: bot.name,
        snippet: displayName(bot.title, "") || bot.description || displayName(bot.name, ""),
      },
      filter === "all" ? CONVERSATION_HIT_LIMIT * 2 : SEARCH_LIMIT,
    );
  }

  // Only groups that can actually be opened: not archived, and still holding
  // enough active-member bots (archiving bots can empty a group below the
  // minimum — those land on the Archived list instead of opening).
  const openableGroups = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT g.id FROM chat_groups g
      WHERE g."spaceId" = ${actor.spaceId}
        AND g."userId" = ${actor.userId}
        AND g."archivedAt" IS NULL
        AND (
          SELECT COUNT(*) FROM chat_group_members gm
          INNER JOIN bots gb ON gb.id = gm."botId"
          WHERE gm."groupId" = g.id AND gb."archivedAt" IS NULL
        ) >= ${GROUP_MEMBER_MIN}
    `,
  );
  const openableGroupIds = openableGroups.map(({ id }) => id);
  const groups = !wants("groups") ? [] : await prisma.chatGroup.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      id: { in: openableGroupIds },
      name: { contains: likeQuery, mode: "insensitive" },
    },
    take: nameLimit,
  });
  for (const group of groups) {
    pushInto(
      conversationHits,
      {
        kind: "conversation",
        groupId: group.id,
        groupName: group.name,
        title: group.name,
        snippet: displayName(group.name, ""),
      },
      filter === "all" ? CONVERSATION_HIT_LIMIT * 2 : SEARCH_LIMIT,
    );
  }

  const contentBudget = Math.max(0, SEARCH_LIMIT - conversationHits.length);

  const artifacts = !wants("files") ? [] : await prisma.artifact.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      groupId: null,
      botId: { not: null },
      name: { contains: likeQuery, mode: "insensitive" },
      bot: { archivedAt: null },
    },
    include: { bot: { select: { name: true } } },
    take: SEARCH_LIMIT,
  });
  const botArtifactMessages = await findArtifactMessages(
    prisma,
    actor,
    artifacts.flatMap((artifact) =>
      artifact.botId && artifact.bot ? [{ id: artifact.id, targetId: artifact.botId }] : [],
    ),
    "bot",
  );
  for (const artifact of artifacts) {
    if (!artifact.botId || !artifact.bot) continue;
    const message = botArtifactMessages.get(artifact.id);
    if (!message) continue;
    pushInto(
      contentHits,
      {
        kind: "file",
        botId: artifact.botId,
        botName: artifact.bot.name,
        title: artifact.name,
        snippet: `${artifact.mimeType}, ${artifact.size} bytes`,
        artifactId: artifact.id,
        messageId: message.id,
        seq: message.seq,
        ...(message.taskThreadId
          ? { taskThreadId: message.taskThreadId, conversationTitle: message.conversationTitle }
          : {}),
      },
      contentBudget,
    );
  }

  const groupArtifacts = !wants("files") ? [] : await prisma.artifact.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      groupId: { in: openableGroupIds },
      name: { contains: likeQuery, mode: "insensitive" },
    },
    include: { group: { select: { name: true } } },
    take: SEARCH_LIMIT,
  });
  const groupArtifactMessages = await findArtifactMessages(
    prisma,
    actor,
    groupArtifacts.flatMap((artifact) =>
      artifact.groupId && artifact.group ? [{ id: artifact.id, targetId: artifact.groupId }] : [],
    ),
    "group",
  );
  for (const artifact of groupArtifacts) {
    if (!artifact.groupId || !artifact.group) continue;
    const message = groupArtifactMessages.get(artifact.id);
    if (!message) continue;
    pushInto(
      contentHits,
      {
        kind: "file",
        groupId: artifact.groupId,
        groupName: artifact.group.name,
        title: artifact.name,
        snippet: `${artifact.mimeType}, ${artifact.size} bytes`,
        artifactId: artifact.id,
        messageId: message.id,
        seq: message.seq,
      },
      contentBudget,
    );
  }

  const routines = !wants("routines") ? [] : await prisma.routine.findMany({
    where: {
      spaceId: actor.spaceId,
      userId: actor.userId,
      OR: [
        { name: { contains: likeQuery, mode: "insensitive" } },
        { prompt: { contains: likeQuery, mode: "insensitive" } },
      ],
      bot: { archivedAt: null },
    },
    include: { bot: { select: { name: true } } },
    take: SEARCH_LIMIT,
  });
  for (const routine of routines) {
    pushInto(
      contentHits,
      {
        kind: "routine",
        botId: routine.botId,
        botName: routine.bot.name,
        title: routine.name,
        snippet: snippetAroundMatch(routine.prompt, query),
        routineId: routine.id,
      },
      contentBudget,
    );
  }

  if (!wants("messages")) return [...conversationHits, ...contentHits].slice(0, SEARCH_LIMIT);
  const match = await messageMatch(prisma, actor.spaceId, query);
  const full = () => contentHits.length >= contentBudget;
  // A Mico's main chat and its side conversations; side-conversation hits name their conversation.
  for (let page = 0; page < match.pages && !full(); page += 1) {
    const messageRows = await openMessages(
      prisma,
      await prisma.$queryRaw<
        Array<{
          id: string;
          threadId: string;
          seq: number;
          blocks: Prisma.JsonValue;
          botId: string;
          botName: string;
          taskThreadId: string | null;
          threadTitle: string | null;
        }>
      >`
      SELECT m.id, m."threadId", m.seq, m.blocks, b.id AS "botId", b.name AS "botName",
        CASE WHEN t."botId" IS NULL THEN t.id END AS "taskThreadId", t.title AS "threadTitle"
      FROM messages m
      INNER JOIN threads t ON t.id = m."threadId"
      INNER JOIN bots b ON b.id = COALESCE(t."botId", t."taskBotId")
      WHERE t."spaceId" = ${actor.spaceId}
        AND t."userId" = ${actor.userId}
        AND b."spaceId" = t."spaceId" AND b."userId" = t."userId"
        AND b."archivedAt" IS NULL
        AND ${micoThread}
        AND ${match.sql}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT ${match.limit} OFFSET ${page * match.limit}
    `,
    );
    for (const row of messageRows) {
      pushMessageHits(row.blocks as MessageBlock[], {
        botId: row.botId,
        botName: row.botName,
        ...conversationOf(row),
        messageId: row.id,
        seq: row.seq,
        query,
        push: (hit) => pushInto(contentHits, hit, contentBudget),
      });
    }
    if (messageRows.length < match.limit) break;
  }

  for (let page = 0; page < match.pages && !full(); page += 1) {
    const groupMessageRows = await openMessages(
      prisma,
      await prisma.$queryRaw<
        Array<{
          id: string;
          threadId: string;
          seq: number;
          blocks: Prisma.JsonValue;
          groupId: string;
          groupName: string;
        }>
      >`
      SELECT m.id, m."threadId", m.seq, m.blocks, g.id AS "groupId", g.name AS "groupName"
      FROM messages m
      INNER JOIN threads t ON t.id = m."threadId"
      INNER JOIN chat_groups g ON g.id = t."groupId"
      WHERE t."spaceId" = ${actor.spaceId}
        AND t."userId" = ${actor.userId}
        AND t."groupId" IS NOT NULL
        AND g.id IN (${Prisma.join(openableGroupIds.length ? openableGroupIds : [null])})
        AND ${match.sql}
      ORDER BY m."createdAt" DESC, m.id DESC
      LIMIT ${match.limit} OFFSET ${page * match.limit}
    `,
    );
    for (const row of groupMessageRows) {
      pushMessageHits(row.blocks as MessageBlock[], {
        groupId: row.groupId,
        groupName: row.groupName,
        messageId: row.id,
        seq: row.seq,
        query,
        push: (hit) => pushInto(contentHits, hit, contentBudget),
      });
    }
    if (groupMessageRows.length < match.limit) break;
  }

  return [...conversationHits, ...contentHits].slice(0, SEARCH_LIMIT);
}

function pushMessageHits(
  blocks: MessageBlock[],
  ctx: {
    botId?: string;
    botName?: string;
    taskThreadId?: string;
    conversationTitle?: string;
    groupId?: string;
    groupName?: string;
    messageId: string;
    seq: number;
    query: string;
    push: (hit: SearchHit) => void;
  },
) {
  // Discriminate on groupId (not name): empty group names must still target the group.
  const destination = ctx.groupId
    ? { groupId: ctx.groupId, groupName: ctx.groupName ?? "" }
    : {
        botId: ctx.botId!,
        botName: ctx.botName!,
        ...(ctx.taskThreadId
          ? { taskThreadId: ctx.taskThreadId, conversationTitle: ctx.conversationTitle ?? "" }
          : {}),
      };
  const title = ctx.groupId ? (ctx.groupName ?? "") : (ctx.botName ?? "");
  let messageHit = false;
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    const text = block.text;
    if (matchesSearchQuery(ctx.query, text)) {
      ctx.push({
        kind: "message",
        ...destination,
        title,
        snippet: snippetAroundMatch(text, ctx.query),
        messageId: ctx.messageId,
        seq: ctx.seq,
      });
      messageHit = true;
    }
    for (const url of extractLinksFromText(text)) {
      if (matchesSearchQuery(ctx.query, url)) {
        ctx.push({
          kind: "link",
          ...destination,
          title: url,
          snippet: snippetAroundMatch(text, ctx.query),
          messageId: ctx.messageId,
          seq: ctx.seq,
          url,
        });
      }
    }
  }
  if (!messageHit && matchesSearchQuery(ctx.query, JSON.stringify(blocks))) {
    ctx.push({
      kind: "message",
      ...destination,
      title,
      snippet: ctx.query,
      messageId: ctx.messageId,
      seq: ctx.seq,
    });
  }
}

/** In-chat search returns at most this many matches and scans a bounded number of pages. */
const THREAD_SEARCH_LIMIT = 100;
const THREAD_SEARCH_PAGE = 100;
const THREAD_SEARCH_PAGES = 5;

/**
 * In-chat search: person and Mico messages of one conversation the caller already resolved,
 * newest first. Encrypted messages match on blind-index tokens and are confirmed after
 * decryption; rows not yet encrypted keep the substring match. Messages the transcript hides
 * are left out so every result can be jumped to.
 */
export async function searchThreadMessages(
  prisma: PrismaClient,
  actor: Actor,
  threadId: string,
  q: string,
): Promise<{ matches: Array<{ messageId: string; seq: number; snippet: string }>; more: boolean }> {
  const query = q.trim();
  if (!query) return { matches: [], more: false };
  const match = await messageMatch(prisma, actor.spaceId, query);
  const matches: Array<{ messageId: string; seq: number; snippet: string }> = [];
  for (let page = 0; page < THREAD_SEARCH_PAGES; page += 1) {
    const rows = await openMessages(
      prisma,
      await prisma.$queryRaw<
        Array<{ id: string; seq: number; role: string; runId: string | null; blocks: Prisma.JsonValue }>
      >`
      SELECT m.id, m.seq, m.role, m."runId", m.blocks
      FROM messages m
      INNER JOIN threads t ON t.id = m."threadId"
      WHERE m."threadId" = ${threadId}
        AND t."spaceId" = ${actor.spaceId}
        AND t."userId" = ${actor.userId}
        AND m.role IN ('user', 'bot')
        AND ${match.sql}
      ORDER BY m.seq DESC
      LIMIT ${THREAD_SEARCH_PAGE} OFFSET ${page * THREAD_SEARCH_PAGE}
    `,
    );
    for (const row of await withoutPeerRunMessages(prisma, rows)) {
      const text = historyMessageText(row.blocks);
      if (!matchesSearchQuery(query, text)) continue;
      if (matches.length === THREAD_SEARCH_LIMIT) return { matches, more: true };
      matches.push({ messageId: row.id, seq: row.seq, snippet: snippetAroundMatch(text, query) });
    }
    if (rows.length < THREAD_SEARCH_PAGE) return { matches, more: false };
  }
  // Candidates remain past the scanned pages.
  return { matches, more: true };
}
