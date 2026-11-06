import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";

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
  archivedAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type InboxTask = z.infer<typeof InboxTaskSchema>;
export const TaskInboxSendSchema = z.object({
  text: z.string().trim().min(1).max(16000),
  clientNonce: z.string().uuid(),
  artifactIds: z.array(Id).max(10).optional(),
});
