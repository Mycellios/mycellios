import type { Actor } from "@mycellios/contracts";
import { RoutineHistorySchema } from "@mycellios/contracts";
import { runFailureError } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { listRoutineRuns } from "./routine-runs.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@mycellios.test",
  isDeploymentOwner: false,
};
const at = new Date("2026-01-02T12:00:00Z");
function fixture() {
  const routine = vi.fn().mockResolvedValue({ botId: "bot-1" });
  const runs = vi.fn().mockResolvedValue([]);
  const messages = vi.fn().mockResolvedValue([]);
  const prisma = {
    routine: { findFirst: routine },
    run: { findMany: runs },
    $queryRaw: messages,
  } as unknown as PrismaClient;
  return { prisma, routine, runs, messages };
}
describe("routine history", () => {
  it("refuses missing, foreign or archived routines before reading runs", async () => {
    const { prisma, routine, runs, messages } = fixture();
    routine.mockResolvedValue(null);
    await expect(listRoutineRuns(prisma, actor, "routine-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(routine).toHaveBeenCalledWith({
      where: {
        id: "routine-1",
        spaceId: actor.spaceId,
        userId: actor.userId,
        bot: { archivedAt: null },
      },
      select: { botId: true, watch: true },
    });
    expect(runs).not.toHaveBeenCalled();
    expect(messages).not.toHaveBeenCalled();
  });
  it("returns a bounded, newest-first history including silent, failed and queued runs", async () => {
    const { prisma, runs, messages } = fixture();
    runs.mockResolvedValue(
      ["completed", "failed", "queued"].map((status, i) => ({
        id: `run-${i}`,
        botId: "bot-1",
        threadId: "thread-1",
        thread: { groupId: i === 1 ? "group-1" : null },
        status,
        error: "504: request timed out",
        createdAt: at,
        startedAt: status === "queued" ? null : at,
        completedAt: status === "queued" ? null : new Date(at.getTime() + 82_000),
      })),
    );
    messages.mockResolvedValue([{ id: "reply-new", runId: "run-1", threadId: "thread-1" }]);
    const history = await listRoutineRuns(prisma, actor, "routine-1");
    expect(RoutineHistorySchema.parse(history)).toEqual(history);
    expect(history.runs.map((row) => row.messageId)).toEqual([null, "reply-new", null]);
    expect(history.runs.map((row) => row.groupId)).toEqual([null, "group-1", null]);
    expect(history.runs[2]?.startedAt).toBeNull();
    expect(history.runs.map((row) => row.error)).toEqual([null, "504: request timed out", null]);
    expect(runs).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ error: true }) }),
    );
    expect(runs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          routineId: "routine-1",
          botId: "bot-1",
          spaceId: actor.spaceId,
          userId: actor.userId,
        },
        take: 101,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    const sql = messages.mock.calls[0]?.[0];
    expect(sql.sql).toContain('DISTINCT ON (m."runId")');
    expect(sql.sql).toContain('r."threadId" = m."threadId"');
    expect(sql.values).toEqual([
      "run-0",
      "run-1",
      "run-2",
      actor.spaceId,
      actor.userId,
      actor.spaceId,
      actor.userId,
    ]);
  });
  it("bounds stored errors, keeping a reason the run reported (up to 500 characters) whole", async () => {
    const { prisma, runs } = fixture();
    const error = "x".repeat(600);
    runs.mockResolvedValue([
      {
        id: "failed-run",
        botId: "bot-1",
        threadId: "thread-1",
        thread: { groupId: null },
        status: "failed",
        error,
        createdAt: at,
        startedAt: at,
        completedAt: at,
      },
    ]);
    const history = await listRoutineRuns(prisma, actor, "routine-1");
    expect(history.runs[0]?.error).toBe(`${"x".repeat(500)}…`);
    expect(history.runs[0]?.error).toBe(
      runFailureError({ type: "run.failed", payload: { error } }, 500),
    );
    const reason = "The supplier site answered 503 three times; nothing was checked.".padEnd(480, ".");
    runs.mockResolvedValue([
      { id: "reported", botId: "bot-1", threadId: "thread-1", thread: { groupId: null },
        status: "failed", error: reason, createdAt: at, startedAt: at, completedAt: at },
    ]);
    expect((await listRoutineRuns(prisma, actor, "routine-1")).runs[0]?.error).toBe(reason);
  });
  it("does not confuse a database failure with an empty history", async () => {
    const { prisma, runs, messages } = fixture();
    runs.mockRejectedValue(new Error("database unavailable"));
    await expect(listRoutineRuns(prisma, actor, "routine-1")).rejects.toThrow(
      "database unavailable",
    );
    expect(messages).not.toHaveBeenCalled();
  });
  it("skips the message query when the routine has never run", async () => {
    const { prisma, messages } = fixture();
    await expect(listRoutineRuns(prisma, actor, "routine-1")).resolves.toEqual({
      runs: [],
      nextCursor: null,
    });
    expect(messages).not.toHaveBeenCalled();
  });
  it("pages all history using stable timestamp/id boundaries without including the lookahead row", async () => {
    const { prisma, runs } = fixture();
    runs.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => ({
        id: `run-${String(200 - i).padStart(3, "0")}`,
        botId: "bot-1",
        threadId: "thread-1",
        thread: { groupId: null },
        status: "completed",
        createdAt: at,
        startedAt: at,
        completedAt: at,
      })),
    );
    const first = await listRoutineRuns(prisma, actor, "routine-1");
    expect(first.runs).toHaveLength(100);
    expect(first.nextCursor).toEqual({ id: "run-101", createdAt: at.toISOString() });
    runs.mockResolvedValue([]);
    const next = await listRoutineRuns(prisma, actor, "routine-1", first.nextCursor!);
    expect(next).toEqual({ runs: [], nextCursor: null });
    expect(runs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          routineId: "routine-1",
          botId: "bot-1",
          spaceId: actor.spaceId,
          userId: actor.userId,
          OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "run-101" } }],
        },
      }),
    );
  });
  it("labels each run by what started it, and marks quiet, late and missed runs", async () => {
    const { prisma, runs } = fixture();
    const scheduledFor = "2026-01-02T08:00:00.000Z";
    const row = (id: string, extra: Record<string, unknown>) => ({
      id, botId: "bot-1", threadId: "thread-1", thread: { groupId: null, taskBotId: "bot-1" },
      status: "completed", error: null, createdAt: at, startedAt: at, completedAt: at,
      trigger: "routine", clientNonce: null, retryOfRunId: null, quiet: false, missedRuns: 0, missedReason: null,
      ...extra,
    });
    runs.mockResolvedValue([
      row("timer", { clientNonce: `routine-timer:routine-1:${scheduledFor}`, quiet: true, missedRuns: 3, missedReason: "offline" }),
      row("manual", { clientNonce: "routine-test:abc" }),
      row("script", { clientNonce: "routine-test:local:n1" }),
      row("mention", { clientNonce: "routine-test:routine-mention:n2:routine-1" }),
      row("hook", { trigger: "webhook", clientNonce: "webhook:bot-1:digest" }),
      row("github", { trigger: "webhook", clientNonce: "github:bot-1:digest" }),
      row("retry", { retryOfRunId: "timer", missedRuns: 1, missedReason: "busy" }),
      row("once", {}),
    ]);
    const history = RoutineHistorySchema.parse(await listRoutineRuns(prisma, actor, "routine-1"));
    expect(history.runs.map((run) => run.source)).toEqual([
      "schedule", "manual", "script", "chat", "webhook", "github", "retry", "schedule",
    ]);
    expect(history.runs[0]).toMatchObject({
      quiet: true,
      scheduledFor,
      missed: { count: 3, reason: "offline" },
      taskThreadId: "thread-1",
    });
    expect(history.runs[1]).toMatchObject({ quiet: false, scheduledFor: null, missed: null });
    expect(history.runs[6]?.missed).toEqual({ count: 1, reason: "busy" });
  });
  it("labels a run of a watching routine without a schedule nonce as a detected change", async () => {
    const { prisma, routine, runs } = fixture();
    routine.mockResolvedValue({ botId: "bot-1", watch: { kind: "command", command: "echo 1" } });
    runs.mockResolvedValue([
      { id: "watch-run", botId: "bot-1", threadId: "thread-1", thread: { groupId: null },
        status: "completed", error: null, createdAt: at, startedAt: at, completedAt: at,
        trigger: "routine", clientNonce: null, retryOfRunId: null },
    ]);
    expect((await listRoutineRuns(prisma, actor, "routine-1")).runs[0]?.source).toBe("watch");
  });
  it("keeps the group destination of a routine execution", async () => {
    const { prisma, runs, messages } = fixture();
    runs.mockResolvedValue([
      {
        id: "group-run",
        botId: "bot-1",
        threadId: "group-thread",
        thread: { groupId: "group-1" },
        status: "completed",
        createdAt: at,
        startedAt: at,
        completedAt: at,
      },
    ]);
    messages.mockResolvedValue([
      { id: "group-reply", runId: "group-run", threadId: "group-thread" },
    ]);
    const history = await listRoutineRuns(prisma, actor, "routine-1");
    expect(RoutineHistorySchema.parse(history).runs[0]).toMatchObject({
      groupId: "group-1",
      messageId: "group-reply",
    });
  });
});
