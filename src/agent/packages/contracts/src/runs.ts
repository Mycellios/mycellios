import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";

/** The computer provider refused a request at its own rate limit; the run tells the user to wait. */
export const COMPUTER_RATE_LIMIT_ERROR = "Too many computer requests. Try again later.";

export const RUN_TRIGGERS = [
  "user",
  "routine",
  "resume",
  "follow_up",
  "reaction",
  "call_end",
  "spawn",
  "skill",
  "bot_message",
  "webhook",
  "messaging",
  "cloud_agent",
  "created",
  "tickets",
  "project_prepare",
  "delegated_task",
  "task_return",
  /** A turn in a conversation the Mico opened itself (start_task or message_task). */
  "agent_task",
  /** A main-chat turn that relays a finished turn of one of those conversations. */
  "task_report",
] as const;
export const RunTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = z.infer<typeof RunTriggerSchema>;

/**
 * What started a routine run: its schedule (recurring or one time), a change it watches, a
 * person (Test or Run), a local script, a mention in chat, a webhook, a GitHub event, or the
 * automatic retry of a failed run.
 */
export const ROUTINE_RUN_SOURCES = [
  "schedule",
  "watch",
  "manual",
  "script",
  "chat",
  "webhook",
  "github",
  "retry",
] as const;
export const RoutineRunSourceSchema = z.enum(ROUTINE_RUN_SOURCES);
export type RoutineRunSource = z.infer<typeof RoutineRunSourceSchema>;

/**
 * Why scheduled runs did not happen and were folded into a later one: the server was not
 * running at their time (offline), or an earlier run had not started yet (busy).
 */
export const ROUTINE_MISSED_REASONS = ["offline", "busy"] as const;
export type RoutineMissedReason = (typeof ROUTINE_MISSED_REASONS)[number];

/** Routine history loads this many runs per page. */
export const ROUTINE_HISTORY_PAGE_SIZE = 100;

export const RoutineRunSchema = z.object({
  id: Id,
  botId: Id,
  groupId: Id.nullable(),
  status: RunStatus,
  error: z.string().nullable(),
  createdAt: IsoDate,
  startedAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  messageId: Id.nullable(),
  taskThreadId: Id.optional(),
  source: RoutineRunSourceSchema.optional(),
  /** The scheduled time a recurring run was created for, when it is one. */
  scheduledFor: IsoDate.nullable().optional(),
  /** Finished with nothing new: nothing was posted and nobody was notified. */
  quiet: z.boolean().optional(),
  /** Scheduled runs that did not happen and were folded into this one. */
  missed: z
    .object({ count: z.number().int().positive(), reason: z.enum(ROUTINE_MISSED_REASONS) })
    .nullable()
    .optional(),
});
export type RoutineRun = z.infer<typeof RoutineRunSchema>;

export const RoutineRunCursorSchema = z.object({ id: Id, createdAt: IsoDate });
export type RoutineRunCursor = z.infer<typeof RoutineRunCursorSchema>;
export const RoutineHistorySchema = z.object({
  runs: z.array(RoutineRunSchema),
  nextCursor: RoutineRunCursorSchema.nullable(),
});
export type RoutineHistory = z.infer<typeof RoutineHistorySchema>;

export const RunActivityRowSchema = z.object({
  runId: Id,
  botId: Id,
  botName: z.string(),
  groupId: Id.nullable(),
  groupName: z.string().nullable(),
  threadId: Id,
  status: RunStatus,
  trigger: RunTriggerSchema,
  notificationsEnabled: z.boolean(),
  promptSnippet: z.string(),
  agentMessage: z
    .discriminatedUnion("kind", [
      z.strictObject({
        fromBotName: z.string(),
        kind: z.enum(["update", "request"]),
        text: z.string().max(120),
      }),
      z.strictObject({ kind: z.literal("unknown") }),
    ])
    .nullable(),
  updatedAt: z.string(),
});
export type RunActivityRow = z.infer<typeof RunActivityRowSchema>;

export const RunsListOutputSchema = z.object({
  runs: z.array(RunActivityRowSchema),
});
export type RunsListOutput = z.infer<typeof RunsListOutputSchema>;
