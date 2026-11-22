import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";
import { SideThreadStartedBySchema } from "./side-threads.js";

export const InboxTaskSchema = z.object({
  id: Id,
  botId: Id,
  threadId: Id,
  title: z.string(),
  runId: Id.nullable(),
  status: RunStatus.nullable(),
  error: z.string().nullable(),
  progress: z.string().nullable(),
  unread: z.boolean(),
  pinned: z.boolean().optional(),
  remindAt: IsoDate.nullable().optional(),
  /** The thread's own archive mark. */
  archivedAt: IsoDate.nullable(),
  /** How the last finished turn ended, and its error; older servers omit both. */
  outcome: z.enum(["completed", "failed", "interrupted"]).nullable().optional(),
  lastError: z.string().max(4000).nullable().optional(),
  /** Who opened the conversation, for its label only; older servers omit it. */
  startedBy: SideThreadStartedBySchema.nullable().optional(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type InboxTask = z.infer<typeof InboxTaskSchema>;
export const TaskInboxSendSchema = z.object({
  text: z.string().trim().min(1).max(16000),
  clientNonce: z.string().uuid(),
  artifactIds: z.array(Id).max(10).optional(),
});
