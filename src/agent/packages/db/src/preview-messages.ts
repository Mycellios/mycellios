import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { contentEncryptionOf } from "./content-encryption.js";

/** JSON containment probe for a quiet routine run marker. */
const QUIET_ROUTINE_RUN_MARKER = JSON.stringify([{ kind: "routine_run", status: "quiet" }]);

/** Prisma filter that leaves out quiet routine run markers. */
export const NOT_QUIET_ROUTINE_RUN = {
  NOT: { role: "system", blocks: { array_contains: [{ kind: "routine_run", status: "quiet" }] } },
};

/** Scalar columns the sidebar preview and its older-page fallback both read. */
export interface SidebarPreviewMessage {
  id: string;
  threadId: string;
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

/**
 * A fingerprint of the same window `withNewestThreadMessages` reads, built in the database from
 * each message's id, role, links and stored blocks (ciphertext when sealed), without decrypting
 * anything. A new message, a streamed update, an edit or a deletion changes it, so a result
 * computed from one window can be reused while the fingerprint stays the same.
 */
export async function newestThreadWindowFingerprints(
  prisma: PrismaClient,
  threadIds: readonly string[],
  limit: number,
  options: { skipQuietRoutineRuns?: boolean } = {},
): Promise<Map<string, string>> {
  if (threadIds.length === 0) return new Map();
  const quiet = options.skipQuietRoutineRuns
    ? Prisma.sql`AND NOT (role = 'system' AND blocks @> ${QUIET_ROUTINE_RUN_MARKER}::jsonb)`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ threadId: string; fingerprint: string }>>(Prisma.sql`
    SELECT t.id AS "threadId",
      md5(coalesce(string_agg(
        m.id || ':' || m.role || ':' || coalesce(m."runId", '') || ':' ||
          coalesce(m."replyToMessageId", '') || ':' || md5(m.blocks::text),
        ',' ORDER BY m.seq DESC), '')) AS fingerprint
    FROM unnest(${[...threadIds]}::text[]) AS t(id)
    LEFT JOIN LATERAL (
      SELECT id, seq, role, "runId", "replyToMessageId", blocks
      FROM messages
      WHERE "threadId" = t.id ${quiet}
      ORDER BY seq DESC
      LIMIT ${limit}
    ) m ON true
    GROUP BY t.id
  `);
  return new Map(rows.map((row) => [row.threadId, row.fingerprint]));
}

/**
 * One indexed read of the newest `limit` messages per thread. A nested `take`
 * on `findMany` is applied in memory and would load every message.
 */
export async function withNewestThreadMessages<T extends { thread: { id: string } | null }>(
  prisma: PrismaClient,
  parents: T[],
  limit: number,
  options: { skipQuietRoutineRuns?: boolean } = {},
) {
  // A quiet routine run's marker is never a preview and never the chat's last activity. Its
  // kind and status stay plain when blocks are sealed, so the filter works either way.
  const quiet = options.skipQuietRoutineRuns
    ? Prisma.sql`AND NOT (role = 'system' AND blocks @> ${QUIET_ROUTINE_RUN_MARKER}::jsonb)`
    : Prisma.empty;
  const threadIds = parents.flatMap((parent) => (parent.thread ? [parent.thread.id] : []));
  const loaded =
    threadIds.length === 0
      ? []
      : await prisma.$queryRaw<SidebarPreviewMessage[]>(Prisma.sql`
          SELECT m.id, m."threadId", m.seq, m.role, m.blocks, m."botId",
            m."replyToMessageId", m."replyQuote", m."runId", m."clientNonce", m."createdAt"
          FROM unnest(${threadIds}::text[]) AS t(id)
          CROSS JOIN LATERAL (
            SELECT id, "threadId", seq, role, blocks, "botId", "replyToMessageId", "replyQuote",
              "runId", "clientNonce", "createdAt"
            FROM messages
            WHERE "threadId" = t.id ${quiet}
            ORDER BY seq DESC
            LIMIT ${limit}
          ) m
          ORDER BY m."threadId", m.seq DESC
        `);
  const opened = (await contentEncryptionOf(prisma)?.openRows("Message", loaded)) ?? loaded;
  const byThread = new Map<string, SidebarPreviewMessage[]>();
  for (const row of opened) {
    const list = byThread.get(row.threadId);
    if (list) list.push(row);
    else byThread.set(row.threadId, [row]);
  }
  return parents.map((parent) => ({
    ...parent,
    thread: parent.thread
      ? { ...parent.thread, messages: byThread.get(parent.thread.id) ?? [] }
      : null,
  }));
}
