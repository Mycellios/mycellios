import * as z from "zod";
import { Id, IsoDate } from "./ids.js";

/**
 * Where a wait a Mico opened with await_event stands. A wait wakes its request once:
 * waiting (or paused with its request), woke (continues after the turn running there),
 * continuing (its request runs again), closed (cancelled, closed or done).
 */
export const OpenWaitStatusSchema = z.enum(["waiting", "paused", "woke", "continuing", "closed"]);
export type OpenWaitStatus = z.infer<typeof OpenWaitStatusSchema>;

/** One row of tasks.waits: an open wait of one conversation, for its "Open waits" card. */
export const OpenWaitSchema = z.object({
  waitId: Id,
  threadId: Id,
  /** The note the Mico saved when it parked the request. */
  note: z.string().max(8_010),
  /** The request it parked, as the person or routine wrote it. */
  request: z.string().max(8_010),
  openedAt: IsoDate,
  expiresAt: IsoDate,
  timeoutMinutes: z.number().int().positive(),
  /** Exactly one of routineId, runId and resumeAt names what it waits for. */
  routineId: Id.optional(),
  routineName: z.string().optional(),
  runId: Id.optional(),
  resumeAt: IsoDate.optional(),
  status: OpenWaitStatusSchema,
  outcome: z.enum(["ready", "failed", "expired"]).optional(),
  settledAt: IsoDate.optional(),
});
export type OpenWait = z.infer<typeof OpenWaitSchema>;

/**
 * The result of "Cancel the wait". `closed` false means nothing was cancelled because the wait
 * had already woken; `status` then says how its request goes on.
 */
export const CancelOpenWaitResultSchema = z.object({
  waitId: Id,
  closed: z.boolean(),
  alreadyClosed: z.boolean(),
  status: OpenWaitStatusSchema,
});
export type CancelOpenWaitResult = z.infer<typeof CancelOpenWaitResultSchema>;
