import type { Actor } from "@mycellios/contracts";
import type { PrismaClient } from "./client.js";
import { Prisma } from "./client.js";
import { contentEncryptionOf } from "./content-encryption.js";
import { historyMessageText } from "./history-text.js";

export const MESSAGE_PIN_LIMIT = 100;
export const MESSAGE_PIN_LIMIT_ERROR = "You can pin up to 100 messages per conversation.";
/** The combined list of one Mico's pins across its main chat and side conversations. */
export const MICO_PIN_LIST_LIMIT = 200;
/** A quote names a message in the newest messages of the conversation, at most this many. */
const QUOTE_SCAN_LIMIT = 500;
const QUOTE_PAGE = 100;

type PinScope = Pick<Actor, "spaceId" | "userId">;

export interface MessagePinRow {
  messageId: string;
  pinnedAt: Date;
  /** The person's own Mico pinned it; null is the person's own pin. */
  pinnedByBotId: string | null;
}

export function listMessagePins(prisma: PrismaClient, actor: PinScope, threadId: string) {
  return prisma.$queryRaw<MessagePinRow[]>`
    SELECT "messageId","pinnedAt","pinnedByBotId" FROM message_pins
    WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId}
    ORDER BY "pinnedAt" DESC,"messageId" LIMIT ${MESSAGE_PIN_LIMIT}`;
}

export interface MicoMessagePinRow extends MessagePinRow {
  threadId: string;
  /** Set on the Mico's main chat; side conversations carry taskBotId instead. */
  botId: string | null;
  taskBotId: string | null;
  projectKey: string | null;
  taskKey: string | null;
  title: string | null;
  archivedAt: Date | null;
}

/**
 * Pins in one Mico's main chat and its own side conversations, newest first. Groups, outside
 * messaging chats and conversations being deleted are left out. Same owner and Space fence.
 */
export function listMicoMessagePins(
  prisma: Pick<PrismaClient, "$queryRaw">,
  actor: PinScope,
  botId: string,
  limit = MICO_PIN_LIST_LIMIT,
) {
  return prisma.$queryRaw<MicoMessagePinRow[]>`
    SELECT p."messageId", p."threadId", p."pinnedAt", p."pinnedByBotId",
      t."botId", t."taskBotId", t."projectKey", t."taskKey", t.title, t."archivedAt"
    FROM message_pins p JOIN threads t ON t.id = p."threadId"
    WHERE p."spaceId"=${actor.spaceId} AND p."userId"=${actor.userId}
      AND t."spaceId"=${actor.spaceId} AND t."userId"=${actor.userId}
      AND t."groupId" IS NULL AND t."externalConversationId" IS NULL AND t."deleteAfter" IS NULL
      AND (t."botId"=${botId} OR (t."botId" IS NULL AND t."taskBotId"=${botId}))
    ORDER BY p."pinnedAt" DESC, p."messageId" LIMIT ${Math.min(Math.max(1, limit), MICO_PIN_LIST_LIMIT)}`;
}

type Tx = Prisma.TransactionClient;

async function lockThreadPins(tx: Tx, actor: PinScope, threadId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.spaceId, actor.userId, threadId])},0))::text AS "lock"`;
}

async function threadPins(tx: Tx, actor: PinScope, threadId: string) {
  return tx.$queryRaw<Array<{ messageId: string; pinnedByBotId: string | null }>>`
    SELECT "messageId","pinnedByBotId" FROM message_pins
    WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId}`;
}

/**
 * The person pins or unpins. Caller resolves the owned conversation and visible message before
 * entering; no content is copied. Pinning a message the Mico pinned makes it the person's pin;
 * unpinning removes the pin whoever made it.
 */
export async function setMessagePin(prisma: PrismaClient, actor: PinScope, threadId: string, messageId: string, pinned: boolean) {
  await prisma.$transaction(async (tx) => {
    await lockThreadPins(tx, actor, threadId);
    if (!pinned) {
      await tx.$executeRaw`DELETE FROM message_pins WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId} AND "messageId"=${messageId}`;
      return;
    }
    const existing = await threadPins(tx, actor, threadId);
    const current = existing.find((pin) => pin.messageId === messageId);
    if (current) {
      if (current.pinnedByBotId)
        await tx.$executeRaw`UPDATE message_pins SET "pinnedByBotId"=NULL WHERE "spaceId"=${actor.spaceId} AND "userId"=${actor.userId} AND "threadId"=${threadId} AND "messageId"=${messageId}`;
      return;
    }
    if (existing.length >= MESSAGE_PIN_LIMIT) throw new Error(MESSAGE_PIN_LIMIT_ERROR);
    await tx.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId") VALUES (${messageId},${threadId},${actor.spaceId},${actor.userId}) ON CONFLICT ("messageId","userId") DO NOTHING`;
  });
}

/** A pin_message refusal the model reads as the tool result. */
export class MessagePinError extends Error {
  constructor(
    readonly code: "limit" | "person_pin" | "not_found" | "conversation",
    message: string,
  ) {
    super(message);
    this.name = "MessagePinError";
  }
}

export type AgentPinState = "pinned" | "already_pinned" | "unpinned" | "not_pinned";

/**
 * A Mico pins or unpins a message in its own main chat or side conversation, for the person
 * who owns it. Its pins count toward the same 100 per conversation and the person can remove
 * them; it never removes the person's own pins. Caller resolves the message in that thread.
 */
export async function setAgentMessagePin(
  prisma: PrismaClient,
  scope: PinScope & { botId: string },
  threadId: string,
  messageId: string,
  pinned: boolean,
): Promise<{ state: AgentPinState; pinnedBy: "you" | "person" | null }> {
  return prisma.$transaction(async (tx) => {
    const [thread] = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT t.id FROM threads t JOIN bots b ON b.id = ${scope.botId}
      WHERE t.id = ${threadId} AND t."spaceId" = ${scope.spaceId} AND t."userId" = ${scope.userId}
        AND t."groupId" IS NULL AND t."externalConversationId" IS NULL AND t."deleteAfter" IS NULL
        AND (t."botId" = ${scope.botId} OR (t."botId" IS NULL AND t."taskBotId" = ${scope.botId}))
        AND b."spaceId" = ${scope.spaceId} AND b."userId" = ${scope.userId} AND b."archivedAt" IS NULL`;
    if (!thread) throw new MessagePinError("conversation", "Pins can only be changed in your own conversations.");
    await lockThreadPins(tx, scope, threadId);
    const existing = await threadPins(tx, scope, threadId);
    const current = existing.find((pin) => pin.messageId === messageId);
    const pinnedBy = current ? (current.pinnedByBotId === scope.botId ? ("you" as const) : ("person" as const)) : null;
    if (!pinned) {
      if (!current) return { state: "not_pinned" as const, pinnedBy };
      if (current.pinnedByBotId !== scope.botId)
        throw new MessagePinError("person_pin", "The person pinned this message themselves, so only they can unpin it.");
      await tx.$executeRaw`DELETE FROM message_pins WHERE "spaceId"=${scope.spaceId} AND "userId"=${scope.userId} AND "threadId"=${threadId} AND "messageId"=${messageId} AND "pinnedByBotId"=${scope.botId}`;
      return { state: "unpinned" as const, pinnedBy: null };
    }
    if (current) return { state: "already_pinned" as const, pinnedBy };
    if (existing.length >= MESSAGE_PIN_LIMIT)
      throw new MessagePinError("limit", "This conversation already has 100 pinned messages. Unpin one of yours first, or ask the person to.");
    await tx.$executeRaw`INSERT INTO message_pins ("messageId","threadId","spaceId","userId","pinnedByBotId") VALUES (${messageId},${threadId},${scope.spaceId},${scope.userId},${scope.botId}) ON CONFLICT ("messageId","userId") DO NOTHING`;
    return { state: "pinned" as const, pinnedBy: "you" as const };
  });
}

interface PinCandidate {
  id: string;
  seq: number;
  role: string;
  blocks: Prisma.JsonValue;
}

const normalized = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The message a pin_message call names in this conversation: the message with that id, or the
 * newest message whose text holds the quote. Only person and Mico messages from the readable
 * part of the conversation (after a New chat reset) qualify. Null when nothing matches.
 */
export async function findPinTarget(
  prisma: Pick<PrismaClient, "$queryRaw">,
  thread: { id: string; contextStartSeq: number },
  input: { messageId?: string; quote?: string },
): Promise<{ messageId: string; role: "user" | "bot"; seq: number } | null> {
  const open = async (rows: PinCandidate[]) => (await contentEncryptionOf(prisma)?.openRows("Message", rows)) ?? rows;
  if (input.messageId) {
    const [row] = await prisma.$queryRaw<Array<{ id: string; seq: number; role: string }>>`
      SELECT id, seq, role FROM messages
      WHERE id = ${input.messageId} AND "threadId" = ${thread.id} AND role IN ('user','bot')
        AND seq >= ${thread.contextStartSeq}`;
    return row ? { messageId: row.id, role: row.role as "user" | "bot", seq: row.seq } : null;
  }
  const quote = normalized(input.quote ?? "");
  if (!quote) return null;
  let before: number | null = null;
  for (let scanned = 0; scanned < QUOTE_SCAN_LIMIT; scanned += QUOTE_PAGE) {
    const rows = await open(
      await prisma.$queryRaw<PinCandidate[]>`
        SELECT id, seq, role, blocks FROM messages
        WHERE "threadId" = ${thread.id} AND role IN ('user','bot') AND seq >= ${thread.contextStartSeq}
          ${before === null ? Prisma.empty : Prisma.sql`AND seq < ${before}`}
        ORDER BY seq DESC LIMIT ${QUOTE_PAGE}`,
    );
    const match = rows.find((row) => normalized(historyMessageText(row.blocks)).includes(quote));
    if (match) return { messageId: match.id, role: match.role as "user" | "bot", seq: match.seq };
    if (rows.length < QUOTE_PAGE) break;
    before = rows.at(-1)!.seq;
  }
  return null;
}
