import type { RoutineRun } from "@rakazo/contracts";

/** Older history remains linked to the original chat; private work carries its exact target. */
export function routineThreadPath(run: Pick<RoutineRun, "botId" | "groupId" | "messageId" | "taskThreadId">): string | null {
  if (!run.messageId && !run.taskThreadId) return null;
  const query = new URLSearchParams();
  if (run.messageId) query.set("m", run.messageId);
  if (!run.groupId && run.taskThreadId) query.set("task", run.taskThreadId);
  const path = run.groupId ? `/app/g/${encodeURIComponent(run.groupId)}` : `/app/${encodeURIComponent(run.botId)}`;
  return `${path}?${query.toString()}`;
}
