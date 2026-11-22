import * as z from "zod";
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
