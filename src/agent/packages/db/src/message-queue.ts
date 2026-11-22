import {
  MESSAGE_QUEUE_LIST_LIMIT,
  MESSAGE_QUEUE_REORDER_LIMIT,
  type MessageBlock,
  type MessageQueueSteerBlock,
} from "@mycellios/contracts";
import {
  isConversationalRun,
  MessageQueueConflictError,
  QUEUE_HOLDING_RUN_STATUSES,
} from "@mycellios/core";
import type { Prisma } from "./client.js";
import { appendEventInTransaction, createPendingSteeringRun } from "./events.js";
import { compareQueuedRows, queuedPosition } from "./queue-order.js";

export { compareQueuedRows, queuedPosition };

/**
 * Controls for the messages that wait in a conversation (specs/mico-message-queue). Every
 * action takes the thread row lock that sends take, so it is ordered with sends, steering
 * claims, finalizeRun and stop. Only the person's own `queued_user` rows that no turn holds
 * (runId null) are in the queue; once a turn holds a row it has started and leaves the queue.
 * Nothing here releases a human computer takeover or lets the running turn claim a queued row.
 */

/** One conversation's queue: a Mico's thread, or a group thread with its member Micos. */
export interface MessageQueueTarget {
  spaceId: string;
  threadId: string;
  botIds: string[];
}

const QUEUED = { originTrigger: "queued_user", runId: null } as const;
const QUEUED_MESSAGE_SELECT = {
  id: true,
  seq: true,
  role: true,
  blocks: true,
  createdAt: true,
  runId: true,
} as const;

type QueuedRow = Prisma.SteeringMessageGetPayload<{
  include: { message: { select: typeof QUEUED_MESSAGE_SELECT } };
}>;

/** A waiting message with its rows (one per Mico it is for; one in a Mico's own thread). */
export interface QueuedMessageEntry {
  messageId: string;
  position: number;
  seq: number;
  blocks: MessageBlock[];
  createdAt: Date;
  userId: string;
  heldBy: string | null;
  heldAt: Date | null;
  editDraft: string | null;
  rows: QueuedRow[];
}

export async function lockQueueThread(tx: Prisma.TransactionClient, threadId: string) {
  await tx.$queryRaw`SELECT id FROM threads WHERE id = ${threadId} FOR UPDATE`;
}

function entriesOf(rows: QueuedRow[]): QueuedMessageEntry[] {
  const byMessage = new Map<string, QueuedMessageEntry>();
  for (const row of [...rows].sort(compareQueuedRows)) {
    const known = byMessage.get(row.messageId);
    if (known) {
      known.rows.push(row);
      known.heldBy ??= row.heldBy;
      known.heldAt ??= row.heldAt;
      known.editDraft ??= row.editDraft;
      continue;
    }
    byMessage.set(row.messageId, {
      messageId: row.messageId,
      position: queuedPosition(row),
      seq: row.message.seq,
      blocks: (Array.isArray(row.message.blocks) ? row.message.blocks : []) as MessageBlock[],
      createdAt: row.message.createdAt,
      userId: row.userId,
      heldBy: row.heldBy,
      heldAt: row.heldAt,
      editDraft: row.editDraft,
      rows: [row],
    });
  }
  return [...byMessage.values()];
}

/** The waiting messages in the order they will be sent. */
export async function listMessageQueue(
  tx: Prisma.TransactionClient,
  target: Pick<MessageQueueTarget, "threadId" | "botIds">,
  limit = MESSAGE_QUEUE_LIST_LIMIT,
): Promise<QueuedMessageEntry[]> {
  const rows = await tx.steeringMessage.findMany({
    where: { ...QUEUED, botId: { in: target.botIds }, message: { threadId: target.threadId } },
    include: { message: { select: QUEUED_MESSAGE_SELECT } },
  });
  return entriesOf(rows).slice(0, limit);
}

async function queuedEntry(
  tx: Prisma.TransactionClient,
  target: Pick<MessageQueueTarget, "threadId" | "botIds">,
  messageId: string,
): Promise<QueuedMessageEntry> {
  const rows = await tx.steeringMessage.findMany({
    where: {
      ...QUEUED,
      messageId,
      botId: { in: target.botIds },
      message: { threadId: target.threadId },
    },
    include: { message: { select: QUEUED_MESSAGE_SELECT } },
  });
  const entry = entriesOf(rows)[0];
  if (!entry) throw new MessageQueueConflictError("gone");
  return entry;
}

const rowIds = (entry: QueuedMessageEntry) => entry.rows.map((row) => row.id);

/**
 * Starts an edit: the hold pauses the queue at this message until Save or Cancel. An edit
 * open somewhere else is refused unless the person takes it over here (`takeOver`), which
 * keeps its saved draft; the other place then can no longer save.
 */
export async function holdQueuedMessage(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; holdId: string; takeOver?: boolean },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  const mine = entry.heldBy === input.holdId;
  if (entry.heldBy && !mine && !input.takeOver) throw new MessageQueueConflictError("held");
  const heldAt = mine && entry.heldAt ? entry.heldAt : new Date();
  const keepDraft = Boolean(entry.heldBy);
  if (!mine)
    await tx.steeringMessage.updateMany({
      where: { id: { in: rowIds(entry) } },
      data: { heldBy: input.holdId, heldAt, ...(keepDraft ? {} : { editDraft: null }) },
    });
  return { blocks: entry.blocks, draft: keepDraft ? entry.editDraft : null, heldAt };
}

/** Keeps the unsaved text of an open edit, so a reload or another device can continue it. */
export async function saveQueuedMessageDraft(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; holdId: string; draft: string },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.heldBy !== input.holdId) throw new MessageQueueConflictError("not_held");
  // Sealed per row: encrypted content is written by id.
  for (const row of entry.rows)
    await tx.steeringMessage.update({ where: { id: row.id }, data: { editDraft: input.draft } });
}

/** Cancel: the message goes back unchanged. Says whether the message still waits. */
export async function releaseQueuedMessageHold(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; holdId: string },
): Promise<{ released: boolean; gone: boolean }> {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId).catch((error: unknown) => {
    if (error instanceof MessageQueueConflictError) return null;
    throw error;
  });
  if (!entry) return { released: false, gone: true };
  if (entry.heldBy !== input.holdId) return { released: false, gone: false };
  await tx.steeringMessage.updateMany({
    where: { id: { in: rowIds(entry) } },
    data: { heldBy: null, heldAt: null, editDraft: null },
  });
  return { released: true, gone: false };
}

/** The message's blocks with its text replaced; files and links stay. */
export function queuedMessageBlocks(blocks: readonly MessageBlock[], text: string): MessageBlock[] {
  const rest = blocks.filter((block) => block.kind !== "text");
  const trimmed = text.trim();
  return trimmed ? [{ kind: "text", text: trimmed }, ...rest] : rest;
}

const hasContent = (blocks: readonly MessageBlock[]) =>
  blocks.some((block) => block.kind !== "thread_link");

/** Save: the new text replaces the message everywhere it shows, and the hold ends. */
export async function saveQueuedMessageEdit(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; holdId: string; text: string },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.heldBy !== input.holdId) throw new MessageQueueConflictError("not_held");
  const blocks = queuedMessageBlocks(entry.blocks, input.text);
  if (!hasContent(blocks)) throw new MessageQueueConflictError("empty");
  await tx.message.update({
    where: { id: input.messageId },
    data: { blocks: blocks as Prisma.InputJsonValue },
  });
  await tx.steeringMessage.updateMany({
    where: { id: { in: rowIds(entry) } },
    data: { heldBy: null, heldAt: null, editDraft: null },
  });
  const event = await appendEventInTransaction(tx, {
    spaceId: target.spaceId,
    threadId: target.threadId,
    botId: entry.rows[0]!.botId,
    type: "thread.message.updated",
    payload: { messageId: input.messageId, seq: entry.seq, role: "user", blocks },
  });
  return { blocks, eventSeq: event.seq };
}

/**
 * Removes a waiting message from the queue and from the conversation. A message someone is
 * editing is removed only when the caller confirmed it (`force`).
 */
export async function deleteQueuedMessage(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; force?: boolean },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.heldBy && !input.force) throw new MessageQueueConflictError("held");
  return removeQueuedMessageInTransaction(tx, target, entry);
}

/** Deletes the message row (its queue rows and pins go with it) and tells open views. */
async function removeQueuedMessageInTransaction(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  entry: QueuedMessageEntry,
) {
  await tx.message.delete({ where: { id: entry.messageId } });
  const event = await appendEventInTransaction(tx, {
    spaceId: target.spaceId,
    threadId: target.threadId,
    botId: entry.rows[0]!.botId,
    type: "thread.message.deleted",
    payload: { messageId: entry.messageId, seq: entry.seq },
  });
  return { eventSeq: event.seq };
}

/**
 * Reorders the first `expected.length` waiting messages. `expected` is the order the person
 * saw; any difference means the queue changed meanwhile and nothing is written.
 */
export async function reorderMessageQueue(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { expected: string[]; order: string[] },
) {
  if (
    input.expected.length > MESSAGE_QUEUE_REORDER_LIMIT ||
    input.order.length !== input.expected.length ||
    new Set(input.order).size !== input.order.length ||
    input.order.some((id) => !input.expected.includes(id))
  )
    throw new MessageQueueConflictError("stale");
  await lockQueueThread(tx, target.threadId);
  const entries = await listMessageQueue(tx, target, input.expected.length + 1);
  const current = entries.slice(0, input.expected.length);
  if (
    current.length !== input.expected.length ||
    current.some((entry, index) => entry.messageId !== input.expected[index])
  )
    throw new MessageQueueConflictError("stale");
  // The same positions, handed out in the new order, so messages after them stay after them.
  const positions: number[] = [];
  for (const entry of current)
    positions.push(Math.max(entry.position, (positions.at(-1) ?? -Infinity) + 1));
  for (const [index, messageId] of input.order.entries()) {
    const entry = current.find((candidate) => candidate.messageId === messageId)!;
    if (
      entry.position === positions[index] &&
      entry.rows.every((row) => row.position === positions[index])
    )
      continue;
    await tx.steeringMessage.updateMany({
      where: { id: { in: rowIds(entry) } },
      data: { position: positions[index] },
    });
  }
  return { order: input.order };
}

/** Send now, first step: the message goes to the front. Returns the turns it replaces. */
export async function moveQueuedMessageFirst(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.heldBy) throw new MessageQueueConflictError("held");
  const botIds = entry.rows.map((row) => row.botId);
  // A queued message whose turn has not started yet goes back to the queue instead of being
  // stopped with that turn; it then waits right after this one.
  const unstarted = await tx.run.findMany({
    where: { threadId: target.threadId, botId: { in: botIds }, status: "queued", startedAt: null, trigger: "follow_up" },
    select: { id: true },
  });
  if (unstarted.length)
    await tx.steeringMessage.updateMany({
      where: { runId: { in: unstarted.map((run) => run.id) }, originTrigger: "queued_user", claimedAt: null },
      data: { runId: null },
    });
  const [first] = await listMessageQueue(tx, target, 1);
  if (first && first.messageId !== entry.messageId)
    await tx.steeringMessage.updateMany({
      where: { id: { in: rowIds(entry) } },
      data: { position: first.position - 1 },
    });
  const runs = await tx.run.findMany({
    where: {
      threadId: target.threadId,
      botId: { in: botIds },
      status: { in: [...QUEUE_HOLDING_RUN_STATUSES] },
    },
    select: { id: true },
  });
  return { runIds: runs.map((run) => run.id), botIds };
}

type HoldingRun = { id: string; status: string; trigger: string | null };

/** Why the conversation's current turn cannot take a queued message now, if it cannot. */
export function steerBlockFor(runs: readonly HoldingRun[]): MessageQueueSteerBlock | null {
  const holding = runs.filter((run) =>
    QUEUE_HOLDING_RUN_STATUSES.some((status) => status === run.status),
  );
  if (holding.some((run) => isConversationalRun(run.trigger))) return null;
  if (holding.some((run) => run.trigger === "routine")) return "routine";
  if (holding.length) return "own_work";
  return runs.some((run) => run.status === "waiting_input") ? "waiting" : "idle";
}

/**
 * Steer now: the message joins the turn that is running, which takes it at its next step as
 * the person's own correction. It is never taken this way without this explicit action.
 */
export async function steerQueuedMessage(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.heldBy) throw new MessageQueueConflictError("held");
  const runs = await tx.run.findMany({
    where: {
      threadId: target.threadId,
      botId: { in: entry.rows.map((row) => row.botId) },
      status: { in: [...QUEUE_HOLDING_RUN_STATUSES, "waiting_input"] },
    },
    select: { id: true, botId: true, status: true, trigger: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const steered: Array<{ rowId: string; runId: string }> = [];
  for (const row of entry.rows) {
    const own = runs.filter((run) => run.botId === row.botId);
    const block = steerBlockFor(own);
    if (block) throw new MessageQueueConflictError(block);
    const run = own.find(
      (candidate) =>
        QUEUE_HOLDING_RUN_STATUSES.some((status) => status === candidate.status) &&
        isConversationalRun(candidate.trigger),
    )!;
    steered.push({ rowId: row.id, runId: run.id });
  }
  // The person's own steering (no origin), so taking it never marks the turn as outside content.
  for (const { rowId, runId } of steered)
    await tx.steeringMessage.update({
      where: { id: rowId },
      data: { runId, originTrigger: null, position: null, heldBy: null, heldAt: null },
    });
  return { runIds: [...new Set(steered.map((item) => item.runId))] };
}

/**
 * Takes a waiting message out of the queue to start somewhere else (Move to a new
 * conversation). Only a message the person sent to this one Mico, and not being edited.
 */
export async function takeQueuedMessage(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  input: { messageId: string; userId: string },
) {
  await lockQueueThread(tx, target.threadId);
  const entry = await queuedEntry(tx, target, input.messageId);
  if (entry.rows.length !== 1 || target.botIds.length !== 1 || entry.userId !== input.userId)
    throw new MessageQueueConflictError("not_alone");
  if (entry.heldBy) throw new MessageQueueConflictError("held");
  return {
    entry,
    remove: () => removeQueuedMessageInTransaction(tx, target, entry),
  };
}

/**
 * Starts the next waiting message for each Mico that has no turn here, after an action that
 * may have unblocked the queue. Returns the continuation runs to wake.
 */
export async function dispatchMessageQueue(
  tx: Prisma.TransactionClient,
  target: MessageQueueTarget,
  options: { preferMessageId?: string } = {},
) {
  const runIds: string[] = [];
  for (const botId of target.botIds) {
    const runId = await createPendingSteeringRun(
      tx,
      { spaceId: target.spaceId, threadId: target.threadId, botId },
      options,
    );
    if (runId) runIds.push(runId);
  }
  return runIds;
}
