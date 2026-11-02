import * as z from "zod";
import { Id, IsoDate, RunStatus } from "./ids.js";
import { RoutineRunCursorSchema, RunTriggerSchema } from "./runs.js";

export const RunLogIssueSchema = z.enum([
  "computer_missing",
  "computers_disabled",
  "model_unavailable",
  "context_limit",
  "rate_limit",
  "provider_auth",
  "execution_failed",
]);
export type RunLogIssue = z.infer<typeof RunLogIssueSchema>;

export const RunLogsInputSchema = z.object({
  botId: Id.optional(),
  before: RoutineRunCursorSchema.optional(),
  limit: z.number().int().min(1).max(50).default(25),
});
export type RunLogsInput = z.input<typeof RunLogsInputSchema>;

export const RunLogRowSchema = z.object({
  id: Id,
  botId: Id,
  botName: z.string(),
  status: RunStatus,
  trigger: RunTriggerSchema,
  issue: RunLogIssueSchema.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
  startedAt: IsoDate.nullable(),
  firstResponseAt: IsoDate.nullable(),
  completedAt: IsoDate.nullable(),
  modelProvider: z.string().nullable(),
  modelId: z.string().nullable(),
  dispatchCount: z.number().int().nonnegative(),
  attemptCount: z.number().int().nonnegative(),
  attempts: z
    .array(
      z.object({
        id: Id,
        status: z.enum(["running", "completed", "failed", "cancelled", "other"]),
        issue: RunLogIssueSchema.nullable(),
        startedAt: IsoDate,
        finishedAt: IsoDate.nullable(),
      }),
    )
    .max(10),
});
export type RunLogRow = z.infer<typeof RunLogRowSchema>;

export const RunLogsOutputSchema = z.object({
  observedAt: IsoDate,
  runs: z.array(RunLogRowSchema).max(50),
  agents: z.array(z.object({ id: Id, name: z.string() })).max(200),
  nextCursor: RoutineRunCursorSchema.nullable(),
});
export type RunLogsOutput = z.infer<typeof RunLogsOutputSchema>;
