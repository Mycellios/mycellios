import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/**
 * Where one recipient of a Mico's request stands, as the "Waiting for replies" list shows it:
 * asked (its turn has not started), working, needs_you (it waits on the person), replied,
 * failed or stopped. The last three are settled.
 */
export const AwaitingReplyStateSchema = z.enum([
  "asked",
  "working",
  "needs_you",
  "replied",
  "failed",
  "stopped",
]);
export type AwaitingReplyState = z.infer<typeof AwaitingReplyStateSchema>;

export const AwaitingReplyRecipientSchema = z.object({
  botId: Id,
  name: z.string(),
  state: AwaitingReplyStateSchema,
});
export type AwaitingReplyRecipient = z.infer<typeof AwaitingReplyRecipientSchema>;

/** One request of a Mico's main chat that waits (or waited) for answers from other Micos. */
export const AwaitingReplyRequestSchema = z.object({
  requestId: Id,
  /** A group the request was sent to with send_to_group; absent for a direct message. */
  groupId: Id.optional(),
  groupName: z.string().optional(),
  createdAt: IsoDate,
  /** Every recipient answered, failed or was stopped. */
  settled: z.boolean(),
  recipients: z.array(AwaitingReplyRecipientSchema),
});
export type AwaitingReplyRequest = z.infer<typeof AwaitingReplyRequestSchema>;

/**
 * A task this conversation delegated (delegate_task) that has not finished, with what the
 * revisioned work controls need. A paused one is the "stopped" task the card offers to continue.
 */
export const AwaitingWorkSchema = z.object({
  taskId: Id,
  botId: Id,
  name: z.string(),
  delegationState: z.string(),
  revision: z.number().int().nonnegative(),
  paused: z.boolean(),
  stopping: z.boolean(),
});
export type AwaitingWork = z.infer<typeof AwaitingWorkSchema>;

export const AwaitingRepliesSchema = z.object({
  requests: z.array(AwaitingReplyRequestSchema),
  work: z.array(AwaitingWorkSchema),
});
export type AwaitingReplies = z.infer<typeof AwaitingRepliesSchema>;

export const StopAwaitingReplyInputSchema = z.object({ requestId: Id, botId: Id });
export const HideAwaitingRepliesInputSchema = z.object({
  requestIds: z.array(Id).min(1).max(20),
});
