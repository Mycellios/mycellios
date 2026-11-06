import type { Actor, Routine } from "@rakazo/contracts";
import { RoutineCalendarInputSchema, RoutineCalendarSchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { plannedRoutineEntries, routineCalendar } from "./routine-calendar.js";

const actor = { userId: "owner", spaceId: "space" } as Actor;
const now = new Date("2026-11-04T12:00:00Z"),
  from = new Date("2026-11-02T00:00:00Z"),
  to = new Date("2026-11-09T00:00:00Z");
const routine = {
  id: "r",
  botId: "b",
  name: "Daily",
  prompt: "Review",
  crons: ["0 9 * * *"],
  timezone: "Europe/Madrid",
  active: true,
  notify: true,
  webhookEnabled: false,
  githubEnabled: false,
  messageProvider: null,
  modelProvider: null,
  modelId: null,
  thinkingLevel: null,
  watch: null,
  watchState: null,
  lastRunAt: null,
  nextRunAt: "2026-11-05T08:00:00Z",
  createdAt: "2026-10-01T00:00:00Z",
} satisfies Routine;
describe("routine calendar", () => {
  it("projects only future executions and retains paused occurrences without claiming they will run", () => {
    const active = plannedRoutineEntries(routine, from, to, now);
    expect(active.entries).toHaveLength(4);
    expect(active.entries[0]).toMatchObject({
      at: new Date(routine.nextRunAt!).toISOString(),
      projected: true,
      status: "scheduled",
    });
    const paused = plannedRoutineEntries(
      { ...routine, active: false, nextRunAt: null },
      from,
      to,
      now,
    );
    expect(paused.entries).toHaveLength(4);
    expect(paused.entries.every((entry) => entry.status === "paused")).toBe(true);
  });
  it("keeps the worker's uneven interval anchor", () => {
    const result = plannedRoutineEntries(
      { ...routine, crons: ["*/7 * * * *"], timezone: "UTC", nextRunAt: "2026-11-04T12:14:00Z" },
      from,
      new Date("2026-11-04T12:33:00Z"),
      now,
    );
    expect(result.entries.map((entry) => entry.at)).toEqual([
      "2026-11-04T12:14:00.000Z",
      "2026-11-04T12:21:00.000Z",
      "2026-11-04T12:28:00.000Z",
    ]);
  });
  it("resolves daily local times across DST", () => {
    const result = plannedRoutineEntries(
      { ...routine, nextRunAt: "2026-03-28T08:00:00Z" },
      new Date("2026-03-28"),
      new Date("2026-03-31"),
      new Date("2026-03-28"),
    );
    expect(result.entries.map((entry) => entry.at)).toEqual([
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
      "2026-03-30T07:00:00.000Z",
    ]);
  });
  it("never recreates consumed one-shots or predicts webhook/watch executions", () => {
    expect(
      plannedRoutineEntries({ ...routine, crons: ["@once"], nextRunAt: null }, from, to, now)
        .entries,
    ).toEqual([]);
    expect(plannedRoutineEntries({ ...routine, crons: [] }, from, to, now).entries).toEqual([]);
    expect(
      plannedRoutineEntries({ ...routine, crons: ["@once"] }, from, to, now).entries,
    ).toHaveLength(1);
  });
  it("bounds expansion and flags invalid schedules", () => {
    expect(plannedRoutineEntries({ ...routine, crons: ["@once"] }, from, to, now, 0)).toMatchObject(
      { entries: [], truncated: true },
    );
    expect(
      plannedRoutineEntries({ ...routine, timezone: "not/a-zone" }, from, to, now).invalid,
    ).toBe(true);
    expect(
      plannedRoutineEntries(
        { ...routine, crons: ["* * * * *"], nextRunAt: null },
        from,
        to,
        now,
        3,
      ),
    ).toMatchObject({ truncated: true, entries: expect.any(Array) });
    expect(plannedRoutineEntries({ ...routine, crons: ["invalid"] }, from, to, now).invalid).toBe(
      true,
    );
    expect(
      RoutineCalendarInputSchema.safeParse({ from: from.toISOString(), to: "2028-01-01T00:00:00Z" })
        .success,
    ).toBe(false);
    expect(
      RoutineCalendarInputSchema.safeParse({ from: to.toISOString(), to: from.toISOString() })
        .success,
    ).toBe(false);
  });
  it("reads history by exact account/Space and reports actual failed/cancelled outcomes", async () => {
    const findRoutines = vi.fn().mockResolvedValue([
      {
        ...routine,
        createdAt: new Date(routine.createdAt),
        lastRunAt: null,
        nextRunAt: new Date(routine.nextRunAt!),
      },
    ]);
    const findRuns = vi.fn().mockResolvedValue([
      {
        id: "actual",
        routineId: "r",
        createdAt: new Date("2026-11-03T09:12:00Z"),
        status: "cancelled",
        error: null,
      },
    ]);
    const prisma = {
      routine: { findMany: findRoutines },
      run: { findMany: findRuns },
    } as unknown as PrismaClient;
    const result = await routineCalendar(
      prisma,
      actor,
      { from: from.toISOString(), to: to.toISOString() },
      now,
    );
    expect(RoutineCalendarSchema.parse(result)).toEqual(result);
    expect(result.entries[0]).toMatchObject({
      id: "actual",
      projected: false,
      status: "cancelled",
    });
    expect(findRoutines.mock.calls[0]![0].where).toEqual({
      userId: "owner",
      spaceId: "space",
      bot: { archivedAt: null },
    });
    expect(findRuns.mock.calls[0]![0].where).toMatchObject({
      userId: "owner",
      spaceId: "space",
      routineId: { in: ["r"] },
    });
  });
});
