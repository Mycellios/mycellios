import * as z from "zod";
import { MessageBlock } from "./events.js";
import { Id, IsoDate } from "./ids.js";

/** What a Mico side thread is doing now; closed means archived or being deleted. */
export const SideThreadStateSchema = z.enum(["running", "queued", "waiting", "idle", "closed"]);
/** How its last finished turn ended. */
export const SideThreadOutcomeSchema = z.enum(["completed", "failed", "interrupted"]);
export const SideThreadTitleSourceSchema = z.enum(["auto", "agent", "user"]);
export const SideThreadStartedBySchema = z.enum(["user", "agent", "routine", "branch", "delegation"]);
/** At most 2000 characters, which may take up to 4000 UTF-16 units. */
export const SideThreadErrorSchema = z.string().max(4000);

export const SideThreadTargetSchema = z.object({ botId: Id, taskThreadId: Id });

/**
 * One row of development.list. Everything after `kind` is optional so newer clients can
 * read an older server; a null `titleSource` means the title predates title sources.
 */
export const SideThreadSchema = z.object({
  threadId: Id,
  projectKey: z.string(),
  taskKey: z.string(),
  title: z.string(),
  kind: z.enum(["conversation", "routine", "workflow", "delegation", "project", "other"]).optional(),
  /** Mirrors `archivedAt`, for clients that only know the boolean. */
  archived: z.boolean().optional(),
  archivedAt: IsoDate.nullable().optional(),
  /** Set while a delete can still be undone; the thread is hidden until it is removed. */
  deleteAfter: IsoDate.nullable().optional(),
  state: SideThreadStateSchema.optional(),
  outcome: SideThreadOutcomeSchema.nullable().optional(),
  lastError: SideThreadErrorSchema.nullable().optional(),
  titleSource: SideThreadTitleSourceSchema.nullable().optional(),
  startedBy: SideThreadStartedBySchema.nullable().optional(),
  createdAt: IsoDate.optional(),
  updatedAt: IsoDate.optional(),
  /** A reply the person has not read yet. */
  unread: z.boolean().optional(),
  /** Waits (await_event) its Mico parked here that have not woken yet. */
  openWaits: z.number().int().nonnegative().optional(),
  /**
   * For a branch (startedBy "branch"): the conversation it was copied from, or null once that
   * conversation is gone. Absent for other conversations and on older servers.
   */
  branchedFromThreadId: Id.nullable().optional(),
  /**
   * A Space member's own conversation with this shared Mico (specs/space-members): its owner can
   * read it, only that person writes in it. Absent for the owner's own conversations.
   */
  memberUserId: Id.optional(),
});
export type SideThread = z.infer<typeof SideThreadSchema>;

/**
 * development.branch: copies a finished turn of the main chat (no taskThreadId) or of a side
 * conversation into a new conversation of the same Mico. A retry with the same requestId
 * returns the same branch.
 */
export const BranchConversationInputSchema = z.object({
  botId: Id,
  taskThreadId: Id.optional(),
  /** A Mico message of the finished turn the copy ends with. */
  messageId: Id,
  requestId: z.string().uuid(),
});
export type BranchConversationInput = z.infer<typeof BranchConversationInputSchema>;
export const BranchConversationOutputSchema = z.object({
  threadId: Id,
  title: z.string(),
  /** The branch already existed for this requestId; nothing new was copied. */
  replayed: z.boolean(),
});
export type BranchConversationOutput = z.infer<typeof BranchConversationOutputSchema>;

/**
 * What an open conversation of a Mico waits for from the person: a question, an approval, a
 * plan to confirm, a credential, or someone to take over the computer.
 */
export const SideThreadRequestKindSchema = z.enum(["question", "approval", "plan", "secret", "takeover"]);
export type SideThreadRequestKind = z.infer<typeof SideThreadRequestKindSchema>;

/**
 * One row of development.requests: a pending request of one of the Mico's open conversations,
 * shown again in its main chat. The answer always goes through that conversation's own fenced
 * answer operation (threads.answer with its taskThreadId).
 */
export const SideThreadRequestSchema = z.object({
  threadId: Id,
  title: z.string(),
  runId: Id,
  /** The message holding the pending ask; null for a takeover, which has none. */
  messageId: Id.nullable(),
  kind: SideThreadRequestKindSchema,
  /** The pending ask block itself, as the conversation shows it. */
  block: MessageBlock.nullable(),
  createdAt: IsoDate,
});
export type SideThreadRequest = z.infer<typeof SideThreadRequestSchema>;

/**
 * A Mico's open conversations at a glance, for the sidebar: how many are open, how many have a
 * reply the person has not read, wait for them or work. `revision` changes whenever any of them
 * moves, so clients know when to read the list again.
 */
export const MicoConversationSummarySchema = z.object({
  open: z.number().int().nonnegative(),
  unread: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  revision: z.string().max(200),
});
export type MicoConversationSummary = z.infer<typeof MicoConversationSummarySchema>;
