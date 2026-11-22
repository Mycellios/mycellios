import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/** Messages that wait in a conversation while its Mico works (specs/mico-message-queue). */

/** One reorder covers at most this many queued messages. */
export const MESSAGE_QUEUE_REORDER_LIMIT = 100;
/** The queue panel lists at most this many waiting messages. */
export const MESSAGE_QUEUE_LIST_LIMIT = 100;
/** Longest text an edit of a queued message may save. */
export const MESSAGE_QUEUE_EDIT_MAX_LENGTH = 64_000;

/** Why the queued messages wait. */
export const MESSAGE_QUEUE_WAIT_REASONS = [
  "busy",
  "slot",
  "restart",
  "usage",
  "signin",
  "held",
] as const;
export type MessageQueueWaitReason = (typeof MESSAGE_QUEUE_WAIT_REASONS)[number];

/** Why a queued message cannot join the running turn now. */
export const MESSAGE_QUEUE_STEER_BLOCKS = ["idle", "routine", "own_work", "waiting"] as const;
export type MessageQueueSteerBlock = (typeof MESSAGE_QUEUE_STEER_BLOCKS)[number];

/** Answers of a queue action that lost a race or does not apply now (in the error's data). */
export const MESSAGE_QUEUE_CONFLICT_CODES = [
  "gone",
  "held",
  "not_held",
  "stale",
  "empty",
  "not_alone",
  ...MESSAGE_QUEUE_STEER_BLOCKS,
] as const;
export type MessageQueueConflictCode = (typeof MESSAGE_QUEUE_CONFLICT_CODES)[number];

/** A client-made id for one edit session; the same device keeps it across reloads. */
export const QueueHoldIdSchema = z
  .string()
  .min(8)
  .max(100)
  .regex(/^[\w-]+$/);

export const QueuedMessageSchema = z.object({
  messageId: Id,
  /** Up to 1000 characters of its text. */
  text: z.string(),
  createdAt: IsoDate,
  /** The first file, for a thumbnail or a file chip. */
  attachment: z
    .object({
      kind: z.enum(["image", "file"]),
      artifactId: Id,
      mimeType: z.string(),
      name: z.string(),
    })
    .optional(),
  attachmentCount: z.number().int().nonnegative(),
  /** An edit in progress somewhere; it pauses the queue at this message. */
  editing: z
    .object({ holdId: z.string(), since: IsoDate, draft: z.string().nullable() })
    .nullable(),
  /** Whether Move to a new conversation applies (a message to this Mico alone). */
  canMove: z.boolean(),
});
export type QueuedMessage = z.infer<typeof QueuedMessageSchema>;

export const MessageQueueStateSchema = z.object({
  messages: z.array(QueuedMessageSchema),
  /** Why the messages wait; null while nothing waits. */
  waiting: z.enum(MESSAGE_QUEUE_WAIT_REASONS).nullable(),
  /** While waiting for a free slot: the Mico's conversations working now and its limit. */
  slots: z
    .object({ running: z.number().int().nonnegative(), limit: z.number().int().positive() })
    .optional(),
  /** Whether a queued message can join the running turn now, and why not. */
  steer: z.object({
    available: z.boolean(),
    blocked: z.enum(MESSAGE_QUEUE_STEER_BLOCKS).optional(),
  }),
});
export type MessageQueueState = z.infer<typeof MessageQueueStateSchema>;
