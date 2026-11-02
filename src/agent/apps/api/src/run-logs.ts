import type { Actor, RunLogIssue, RunLogRow, RunLogsInput, RunLogsOutput } from "@rakazo/contracts";
import { RunLogsInputSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

const EXECUTING = new Set(["queued", "leased", "running"]);

/** Only known failure categories cross the account boundary, never raw provider/tool output. */
export function runLogIssue(error: string | null): RunLogIssue | null {
  if (!error) return null;
  const firstLine = error.split(/[\r\n]/, 1)[0]?.trim() ?? "";
  if (firstLine === "Bot has no computer") return "computer_missing";
  if (firstLine.startsWith("Computers unavailable.")) return "computers_disabled";
  if (
    firstLine.startsWith("This model's context window is too small.") ||
    firstLine === "context_length_exceeded"
  )
    return "context_limit";
  if (firstLine === "rate_limit_exceeded" || firstLine.startsWith("Too many computer requests."))
    return "rate_limit";
  if (firstLine === "invalid_api_key" || firstLine === "authentication_error")
    return "provider_auth";
  if (firstLine === "Model not configured" || firstLine === "Model unavailable")
    return "model_unavailable";
  return "execution_failed";
}

export async function listRunLogs(
  prisma: PrismaClient,
  actor: Actor,
  input: RunLogsInput,
): Promise<RunLogsOutput> {
  const { botId, before, limit } = RunLogsInputSchema.parse(input);
  const [rows, agents] = await Promise.all([
    prisma.run.findMany({
      where: {
        spaceId: actor.spaceId,
        userId: actor.userId,
        bot: { spaceId: actor.spaceId, userId: actor.userId },
        ...(botId ? { botId } : {}),
        ...(before
          ? {
              OR: [
                { createdAt: { lt: new Date(before.createdAt) } },
                { createdAt: new Date(before.createdAt), id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        botId: true,
        status: true,
        trigger: true,
        error: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        firstResponseAt: true,
        completedAt: true,
        modelProvider: true,
        modelId: true,
        leaseFence: true,
        bot: { select: { name: true, computerId: true } },
        _count: { select: { attempts: true } },
        attempts: {
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: 10,
          select: { id: true, status: true, error: true, startedAt: true, finishedAt: true },
        },
      },
    }),
    prisma.bot.findMany({
      where: { spaceId: actor.spaceId, userId: actor.userId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 200,
      select: { id: true, name: true },
    }),
  ]);
  const runs = rows.slice(0, limit).map((row): RunLogRow => {
    // Diagnose a pre-start failure even when the worker never created an attempt.
    let issue = runLogIssue(row.error);
    if (EXECUTING.has(row.status) && !row.startedAt) {
      if (!row.bot.computerId) issue = "computer_missing";
    }
    if (row.status === "failed" && !issue) issue = "execution_failed";
    return {
      id: row.id,
      botId: row.botId,
      botName: row.bot.name,
      status: row.status as RunLogRow["status"],
      trigger: row.trigger as RunLogRow["trigger"],
      issue,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      modelProvider: row.modelProvider,
      modelId: row.modelId,
      dispatchCount: Math.max(0, row.leaseFence),
      attemptCount: row._count.attempts,
      attempts: row.attempts.map((attempt) => ({
        id: attempt.id,
        status: ["running", "completed", "failed", "cancelled"].includes(attempt.status)
          ? (attempt.status as RunLogRow["attempts"][number]["status"])
          : "other",
        issue: runLogIssue(attempt.error),
        startedAt: attempt.startedAt.toISOString(),
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
      })),
    };
  });
  const last = runs.at(-1);
  return {
    observedAt: new Date().toISOString(),
    runs,
    agents,
    nextCursor: rows.length > limit && last ? { id: last.id, createdAt: last.createdAt } : null,
  };
}
