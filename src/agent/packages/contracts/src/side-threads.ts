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
});
export type SideThread = z.infer<typeof SideThreadSchema>;

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
