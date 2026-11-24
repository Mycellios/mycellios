import { ONCE_ROUTINE_CRON } from "@mycellios/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelScheduleFromTool,
  commandWatchFromTool,
  compactScheduleInput,
  createScheduleFromTool,
  filterBuiltinToolsForRun,
  routineRunMayUpdateSchedule,
  filterBuiltinToolsForThread,
  isOneShotRoutineCron,
  listSchedulesFromTool,
  MAX_ACTIVE_ROUTINES_PER_BOT,
  resolveScheduleTiming,
  RUN_IN_GROUP_ERROR,
  runInFromTool,
  SCHEDULE_TOOL_NAMES,
  updateScheduleFromTool,
} from "./schedule-tools.js";

const noRoutines = async () => [];

describe("resolveScheduleTiming", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-20T00:11:59.999Z") }));
  afterEach(() => vi.useRealTimers());

  it("rejects repeating intervals under one minute", () => {
    expect(resolveScheduleTiming({ every: 2, unit: "seconds" })).toEqual({
      ok: false,
      error: "minimum interval is 1 minute",
    });
  });

  it("accepts every 1 minute", () => {
    const result = resolveScheduleTiming({ every: 1, unit: "minutes" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cron).toBe("*/1 * * * *");
    expect(result.oneShot).toBe(false);
    expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts cron every minute", () => {
    const result = resolveScheduleTiming({ cron: "*/1 * * * *" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cron).toBe("*/1 * * * *");
    expect(result.oneShot).toBe(false);
  });

  it("creates one-shot schedules with @once cron", () => {
    const result = resolveScheduleTiming({ delayMinutes: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cron).toBe(ONCE_ROUTINE_CRON);
    expect(result.oneShot).toBe(true);
    expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it("allows sub-minute one-shot delays via delaySeconds", () => {
    const result = resolveScheduleTiming({ delaySeconds: 30 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cron).toBe(ONCE_ROUTINE_CRON);
    expect(result.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.nextRunAt.getTime()).toBeLessThanOrEqual(Date.now() + 31_000);
  });

  it("rejects one-shot schedules in the past", () => {
    expect(resolveScheduleTiming({ runAt: new Date(Date.now() - 60_000).toISOString() })).toEqual({
      ok: false,
      error:
        "One-shot schedules must run in the future. It is now Tuesday, 2026-10-20 00:11 (UTC+00:00) in UTC.",
    });
  });

  it("reads a runAt without an offset in the routine's timezone", () => {
    const at = (runAt: string, timezone: string) => {
      const result = resolveScheduleTiming({ runAt }, timezone);
      return result.ok ? result.nextRunAt.toISOString() : result.error;
    };
    expect(at("2026-11-02T10:00", "Europe/Berlin")).toBe("2026-11-02T09:00:00.000Z");
    expect(at("2026-11-02T10:00", "America/New_York")).toBe("2026-11-02T15:00:00.000Z");
    expect(at("2026-11-02T10:00:00Z", "America/New_York")).toBe("2026-11-02T10:00:00.000Z");
    expect(at("2026-02-30T10:00", "UTC")).toBe("runAt must be a valid ISO datetime.");
    // 00:30 in Berlin on the 20th already passed (it is 02:11 there).
    expect(at("2026-10-20T00:30", "Europe/Berlin")).toMatch(/^One-shot schedules must run/);
  });

  it("starts a repeat at the first occurrence at or after startAt", () => {
    const first = (input: Record<string, unknown>, timezone: string) => {
      const result = resolveScheduleTiming(input, timezone);
      return result.ok ? result.nextRunAt.toISOString() : result.error;
    };
    // Weekly on Monday at 10:00 in Berlin: without startAt the first run is this coming Monday.
    expect(first({ cron: "0 10 * * 1" }, "Europe/Berlin")).toBe("2026-10-26T09:00:00.000Z");
    expect(first({ cron: "0 10 * * 1", startAt: "2026-11-02" }, "Europe/Berlin")).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    // A startAt that is itself an occurrence is the first run.
    expect(first({ cron: "0 10 * * 1", startAt: "2026-11-02T10:00" }, "Europe/Berlin")).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    expect(first({ cron: "0 10 * * 1", startAt: "2026-11-02T09:00:00Z" }, "Europe/Berlin")).toBe(
      "2026-11-02T09:00:00.000Z",
    );
    expect(first({ cron: "0 10 * * 1", startAt: "2026-11-02T10:00:00.5" }, "Europe/Berlin")).toBe(
      "2026-11-09T09:00:00.000Z",
    );
    // Across New York's fall-back change: 09:00 is EDT on the 31st and EST on 1 November.
    expect(first({ cron: "0 9 * * *", startAt: "2026-10-31" }, "America/New_York")).toBe(
      "2026-10-31T13:00:00.000Z",
    );
    expect(first({ cron: "0 9 * * *", startAt: "2026-11-01" }, "America/New_York")).toBe(
      "2026-11-01T14:00:00.000Z",
    );
    expect(first({ every: 6, unit: "hours", startAt: "2026-11-02T07:00" }, "UTC")).toBe(
      "2026-11-02T12:00:00.000Z",
    );
  });

  it("rejects a startAt that is past, invalid, or on a one-shot", () => {
    expect(resolveScheduleTiming({ cron: "0 9 * * *", startAt: "2026-10-19" })).toEqual({
      ok: false,
      error:
        "startAt is in the past; omit it to start now. It is now Tuesday, 2026-10-20 00:11 (UTC+00:00) in UTC.",
    });
    expect(resolveScheduleTiming({ cron: "0 9 * * *", startAt: "next week" })).toEqual({
      ok: false,
      error: "startAt must be an ISO date or datetime.",
    });
    expect(resolveScheduleTiming({ runAt: "2026-11-02T10:00", startAt: "2026-11-02" })).toEqual({
      ok: false,
      error: "startAt is only for repeating schedules.",
    });
  });

  it("rejects fractional repeat intervals", () => {
    expect(resolveScheduleTiming({ every: 1.5, unit: "minutes" })).toEqual({
      ok: false,
      error: "every must be a positive whole number.",
    });
  });

  it("rejects malformed cron expressions", () => {
    expect(resolveScheduleTiming({ cron: "*/5 *" })).toEqual({
      ok: false,
      error: "cron must be a 5-field cron expression.",
    });
    expect(resolveScheduleTiming({ cron: "foo * * * *" })).toEqual({
      ok: false,
      error: "cron must be a valid 5-field cron expression.",
    });
  });

  it("rejects mixing repeat and one-shot fields", () => {
    expect(resolveScheduleTiming({ cron: "0 9 * * *", delayMinutes: 5 })).toEqual({
      ok: false,
      error: "Provide either a repeating schedule or a one-shot time, not both.",
    });
  });

  it("rejects two repeating timing methods", () => {
    expect(resolveScheduleTiming({ cron: "0 9 * * *", every: 1, unit: "hours" })).toEqual({
      ok: false,
      error: "Provide exactly one timing method: cron, or every and unit, not both.",
    });
  });

  it("ignores null and empty optional fields from model serializers", () => {
    const repeating = resolveScheduleTiming({
      cron: "0 9 * * *",
      every: null,
      unit: "",
      delayMinutes: null,
      runAt: "",
    });
    expect(repeating.ok).toBe(true);
    if (!repeating.ok) return;
    expect(repeating.oneShot).toBe(false);

    const oneShot = resolveScheduleTiming({
      cron: null,
      every: null,
      unit: "",
      delayMinutes: 10,
      delaySeconds: null,
    });
    expect(oneShot.ok).toBe(true);
    if (!oneShot.ok) return;
    expect(oneShot.oneShot).toBe(true);
  });

  it("keeps zero values for normal validation instead of treating them as absent", () => {
    expect(resolveScheduleTiming({ every: 0, unit: "minutes" })).toEqual({
      ok: false,
      error: "every must be a positive whole number.",
    });
    expect(compactScheduleInput({ every: 0, unit: "minutes", cron: null, runAt: "" })).toEqual({
      every: 0,
      unit: "minutes",
    });
  });
});

describe("filterBuiltinToolsForThread", () => {
  const tools = [
    { name: "handoff_to_bot" },
    { name: "message_bot" },
    { name: "schedule_create" },
    { name: "schedule_list" },
    { name: "schedule_cancel" },
    { name: "remember" },
  ];

  it("keeps handoff and schedule tools in groups", () => {
    expect(filterBuiltinToolsForThread(tools, "group-1").map((tool) => tool.name)).toEqual([
      "handoff_to_bot",
      "schedule_create",
      "schedule_list",
      "schedule_cancel",
      "remember",
    ]);
    expect(filterBuiltinToolsForThread(tools, null).map((tool) => tool.name)).toEqual([
      "handoff_to_bot",
      "message_bot",
      "schedule_create",
      "schedule_list",
      "schedule_cancel",
      "remember",
    ]);
  });

  it("hides schedule creation from routine runs and keeps the failure report to routine runs", () => {
    expect(filterBuiltinToolsForRun(tools, "routine").map((tool) => tool.name)).toEqual([
      "handoff_to_bot",
      "message_bot",
      "schedule_list",
      "schedule_cancel",
      "remember",
    ]);
    expect(filterBuiltinToolsForRun(tools, "user").map((tool) => tool.name)).toContain(
      "schedule_create",
    );
    // A routine run keeps schedule_update so it can pause itself; the executor allows only that.
    const withUpdate = [...tools, { name: "schedule_update" }, { name: "routine_report_failure" }];
    expect(filterBuiltinToolsForRun(withUpdate, "routine").map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["schedule_update", "routine_report_failure"]),
    );
    expect(filterBuiltinToolsForRun(withUpdate, "webhook").map((tool) => tool.name)).toContain(
      "routine_report_failure",
    );
    expect(filterBuiltinToolsForRun(withUpdate, "user").map((tool) => tool.name)).toContain(
      "schedule_update",
    );
    for (const trigger of ["user", "agent_task", "task_report", "bot_message"]) {
      expect(filterBuiltinToolsForRun(withUpdate, trigger).map((tool) => tool.name)).not.toContain(
        "routine_report_failure",
      );
    }
  });

  it("lets a routine run only pause its own routine with schedule_update", () => {
    expect(routineRunMayUpdateSchedule("routine-1", { routineId: "routine-1", active: false })).toBe(true);
    expect(
      routineRunMayUpdateSchedule("routine-1", { routineId: " routine-1 ", active: false, name: "", cron: null }),
    ).toBe(true);
    expect(routineRunMayUpdateSchedule("routine-1", { routineId: "routine-2", active: false })).toBe(false);
    expect(routineRunMayUpdateSchedule("routine-1", { routineId: "routine-1", active: true })).toBe(false);
    expect(
      routineRunMayUpdateSchedule("routine-1", { routineId: "routine-1", active: false, prompt: "New work" }),
    ).toBe(false);
    expect(
      routineRunMayUpdateSchedule("routine-1", { routineId: "routine-1", active: false, cron: "* * * * *" }),
    ).toBe(false);
    expect(routineRunMayUpdateSchedule(null, { routineId: "routine-1", active: false })).toBe(false);
  });

  it("composes thread then run filters without dropping group schedule tools", () => {
    const groupTools = filterBuiltinToolsForRun(
      filterBuiltinToolsForThread(tools, "group-1"),
      "routine",
    ).map((tool) => tool.name);
    expect(groupTools).toEqual(["handoff_to_bot", "schedule_list", "schedule_cancel", "remember"]);
    expect(
      filterBuiltinToolsForRun(filterBuiltinToolsForThread(tools, "group-1"), "user").map(
        (tool) => tool.name,
      ),
    ).toContain("schedule_create");
  });

  it("covers every schedule tool name", () => {
    for (const name of SCHEDULE_TOOL_NAMES) {
      expect(filterBuiltinToolsForThread([{ name }, { name: "remember" }], "group-1")).toEqual([
        { name },
        { name: "remember" },
      ]);
    }
  });
});

describe("isOneShotRoutineCron", () => {
  it("detects the one-shot sentinel", () => {
    expect(isOneShotRoutineCron(ONCE_ROUTINE_CRON)).toBe(true);
    expect(isOneShotRoutineCron("0 9 * * *")).toBe(false);
  });
});

describe("schedule tool persistence", () => {
  const noTimezone = { findUnique: vi.fn(async () => null) };
  it.each([{ cron: "0 9 * * *" }, { watch: { kind: "files", paths: ["inbox"] } }])(
    "rejects an invalid timezone before persisting %j",
    async (schedule) => {
      const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: "routine-1",
        ...args.data,
      }));
      const enqueue = vi.fn(async () => undefined);
      const deps = {
        prisma: {
          routine: { create, findMany: noRoutines },
          bot: { findFirst: vi.fn(async () => ({ computer: null })) },
        },
        events: { append: vi.fn() },
        jobs: { enqueue },
      } as unknown as Parameters<typeof createScheduleFromTool>[0];
      const result = await createScheduleFromTool(deps, {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "thread-1",
        name: "Daily",
        prompt: "Check",
        timezone: "Mars/Olympus_Mons",
        schedule,
      });
      expect(result).toEqual({ error: "Unknown timezone" });
      expect(create).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );
  it("refuses a name active anywhere outside a group, and in a group only that group's", async () => {
    const findMany = vi.fn(async () => [
      { id: "routine-1", name: "Morning joke", threadId: "routine-thread-1", thread: { groupId: null } },
      { id: "routine-2", name: "Evening joke", threadId: "group-thread-2", thread: { groupId: "group-2" } },
      { id: "routine-4", name: "Night joke", threadId: "group-thread-1", thread: { groupId: "group-1" } },
    ]);
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "routine-3",
      ...args.data,
    }));
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          create,
          findMany,
        },
      },
      events: { append: vi.fn() },
      jobs: { enqueue: vi.fn() },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: " morning joke ",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toEqual({
      error:
        'An active routine named "Morning joke" already exists (routine-1). Update or cancel it instead.',
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { spaceId: "ws-1", botId: "bot-1", active: true },
      select: { id: true, name: true, threadId: true, thread: { select: { groupId: true } } },
    });
    expect(create).not.toHaveBeenCalled();

    // A group routine of the same name is not this one's duplicate.
    const other = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "Evening joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });
    expect(other).toMatchObject({ ok: true, routineId: "routine-3" });

    const group = { spaceId: "ws-1", botId: "bot-1", userId: "user-1", threadId: "group-thread-1", inGroup: true,
      prompt: "Tell a joke", schedule: { every: 1, unit: "minutes" } };
    expect(await createScheduleFromTool(deps, { ...group, name: "Night joke" })).toMatchObject({
      error: expect.stringContaining("(routine-4)"),
    });
    expect(await createScheduleFromTool(deps, { ...group, name: "Morning joke" })).toMatchObject({ ok: true });
  });

  it("refuses a new routine once the bot has the maximum active", async () => {
    const create = vi.fn();
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          create,
          findMany: vi.fn(async () =>
            Array.from({ length: MAX_ACTIVE_ROUTINES_PER_BOT }, (_, i) => ({
              id: `routine-${i}`,
              name: `Check ${i}`,
              threadId: "thread-1",
            })),
          ),
        },
      },
      events: { append: vi.fn() },
      jobs: { enqueue: vi.fn() },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "One more",
      prompt: "Check",
      schedule: { watch: { kind: "files", paths: ["inbox"] } },
    });

    expect(result).toEqual({
      error: `This bot already has ${MAX_ACTIVE_ROUTINES_PER_BOT} active routines. Cancel one before adding another.`,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates routines with routine.created and enqueues wakeup", async () => {
    const append = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "routine-1",
      ...args.data,
      nextRunAt: args.data.nextRunAt,
    }));
    const deps = {
      prisma: {
        user: noTimezone,
        bot: { findFirst: vi.fn(async () => ({ computer: null })) },
        routine: { create, findMany: noRoutines },
      },
      events: { append },
      jobs: { enqueue, cancel: vi.fn(async () => undefined) },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "Morning joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toMatchObject({ ok: true, routineId: "routine-1", cron: "*/1 * * * *" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          spaceId: "ws-1",
          userId: "user-1",
          // Its first run creates its own conversation.
          threadId: null,
          crons: ["*/1 * * * *"],
          active: true,
        }),
      }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "routine.created",
        threadId: "thread-1",
        payload: { name: "Morning joke" },
      }),
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  describe("where a created routine runs", () => {
    function placeDeps() {
      const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({ id: "routine-1", ...args.data }));
      const findThread = vi.fn(async () => ({ id: "main-thread-1" }));
      const deps = {
        prisma: {
          user: noTimezone,
          bot: { findFirst: vi.fn(async () => ({ computer: null })) },
          routine: { create, findMany: noRoutines },
          thread: { findFirst: findThread },
        },
        events: { append: vi.fn(async () => undefined) },
        jobs: { enqueue: vi.fn(async () => undefined) },
      } as unknown as Parameters<typeof createScheduleFromTool>[0];
      return { deps, create, findThread };
    }
    const base = { spaceId: "ws-1", botId: "bot-1", userId: "user-1", threadId: "task-thread-1",
      name: "Brief", prompt: "Summarize", schedule: { cron: "0 9 * * *" } };
    const placeOf = (create: ReturnType<typeof placeDeps>["create"]) => create.mock.calls[0]![0].data.threadId;

    it("runs in the Mico's main chat when asked, from any conversation", async () => {
      const { deps, create, findThread } = placeDeps();
      await expect(createScheduleFromTool(deps, { ...base, runIn: "chat" })).resolves.toMatchObject({ ok: true });
      expect(findThread).toHaveBeenCalledWith({
        where: { botId: "bot-1", spaceId: "ws-1", userId: "user-1" },
        select: { id: true },
      });
      expect(placeOf(create)).toBe("main-thread-1");
    });

    it("runs in its own conversation by default or when asked, and a watch too", async () => {
      for (const extra of [{}, { runIn: "thread" as const }, { schedule: { watch: { kind: "files", paths: ["inbox"] } } }]) {
        const { deps, create, findThread } = placeDeps();
        await expect(createScheduleFromTool(deps, { ...base, ...extra })).resolves.toMatchObject({ ok: true });
        expect(placeOf(create)).toBeNull();
        expect(findThread).not.toHaveBeenCalled();
      }
    });

    it("keeps a group routine in its group and refuses another place there", async () => {
      const { deps, create } = placeDeps();
      const group = { ...base, threadId: "group-thread-1", inGroup: true };
      await expect(createScheduleFromTool(deps, group)).resolves.toMatchObject({ ok: true });
      expect(placeOf(create)).toBe("group-thread-1");
      create.mockClear();
      for (const runIn of ["thread", "chat"] as const)
        await expect(createScheduleFromTool(deps, { ...group, runIn })).resolves.toEqual({ error: RUN_IN_GROUP_ERROR });
      expect(create).not.toHaveBeenCalled();
    });

    it("reads the place from tool input", () => {
      expect(runInFromTool(undefined)).toEqual({});
      expect(runInFromTool(null)).toEqual({});
      expect(runInFromTool("chat")).toEqual({ runIn: "chat" });
      expect(runInFromTool("group")).toHaveProperty("error");
    });
  });

  it.each([
    { saved: "Europe/Paris", timezone: "Europe/Paris", nextRunAt: "2026-10-19T07:00:00.000Z" },
    { saved: "Mars/Olympus_Mons", timezone: "UTC", nextRunAt: "2026-10-19T09:00:00.000Z" },
  ])("defaults to the user's saved timezone $saved", async ({ saved, timezone, nextRunAt }) => {
    vi.useFakeTimers({ now: new Date("2026-10-18T12:00:00Z") });
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "routine-1",
      ...args.data,
    }));
    const deps = {
      prisma: {
        user: { findUnique: vi.fn(async () => ({ timezone: saved })) },
        routine: { create, findMany: noRoutines },
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined) },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    try {
      await createScheduleFromTool(deps, {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "thread-1",
        name: "Morning brief",
        prompt: "Summarize the news",
        schedule: { cron: "0 9 * * *" },
      });
    } finally {
      vi.useRealTimers();
    }

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ timezone, nextRunAt: new Date(nextRunAt) }),
      }),
    );
  });

  it("createScheduleFromTool creates the routine for the target bot and thread", async () => {
    const append = vi.fn(async () => undefined);
    const enqueue = vi.fn(async () => undefined);
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "routine-1",
      ...args.data,
    }));
    const deps = {
      prisma: { user: noTimezone, routine: { create, findMany: noRoutines } },
      events: { append },
      jobs: { enqueue, cancel: vi.fn(async () => undefined) },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      target: { botId: "child-1", threadId: "child-thread-1" },
      name: "Morning joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toMatchObject({ ok: true, routineId: "routine-1" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ botId: "child-1", threadId: "child-thread-1" }),
      }),
    );
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "routine.created",
        botId: "child-1",
        threadId: "child-thread-1",
      }),
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("keeps the routine when event append fails after enqueue", async () => {
    const cancel = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          findMany: noRoutines,
          create: vi.fn(async () => ({
            id: "routine-1",
            name: "Morning joke",
            crons: ["*/1 * * * *"],
            nextRunAt: new Date(),
          })),
          delete: remove,
        },
      },
      events: {
        append: vi.fn(async () => {
          throw new Error("event failed");
        }),
      },
      jobs: { enqueue: vi.fn(async () => undefined), cancel },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "Morning joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toMatchObject({ ok: true, routineId: "routine-1" });
    expect(cancel).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("rolls back routine when enqueue fails", async () => {
    const remove = vi.fn(async () => undefined);
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          findMany: noRoutines,
          create: vi.fn(async () => ({
            id: "routine-1",
            name: "Morning joke",
            crons: ["*/1 * * * *"],
            nextRunAt: new Date(),
          })),
          delete: remove,
        },
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: {
        enqueue: vi.fn(async () => {
          throw new Error("enqueue failed");
        }),
        cancel: vi.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "Morning joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toEqual({ error: "Could not schedule the reminder. Try again." });
    expect(remove).toHaveBeenCalledWith({ where: { id: "routine-1" } });
  });

  it("deactivates when enqueue fails and delete also fails", async () => {
    const update = vi.fn(async () => undefined);
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          findMany: noRoutines,
          create: vi.fn(async () => ({
            id: "routine-1",
            name: "Morning joke",
            crons: ["*/1 * * * *"],
            nextRunAt: new Date(),
          })),
          delete: vi.fn(async () => {
            throw new Error("delete failed");
          }),
          update,
        },
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: {
        enqueue: vi.fn(async () => {
          throw new Error("enqueue failed");
        }),
        cancel: vi.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    const result = await createScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "thread-1",
      name: "Morning joke",
      prompt: "Tell a joke",
      schedule: { every: 1, unit: "minutes" },
    });

    expect(result).toEqual({ error: "Could not schedule the reminder. Try again." });
    expect(update).toHaveBeenCalledWith({
      where: { id: "routine-1" },
      data: { active: false, nextRunAt: null },
    });
  });

  it("propagates when enqueue rollback cannot deactivate", async () => {
    const deps = {
      prisma: {
        user: noTimezone,
        routine: {
          findMany: noRoutines,
          create: vi.fn(async () => ({
            id: "routine-1",
            name: "Morning joke",
            crons: ["*/1 * * * *"],
            nextRunAt: new Date(),
          })),
          delete: vi.fn(async () => {
            throw new Error("delete failed");
          }),
          update: vi.fn(async () => {
            throw new Error("deactivate failed");
          }),
        },
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: {
        enqueue: vi.fn(async () => {
          throw new Error("enqueue failed");
        }),
        cancel: vi.fn(async () => undefined),
      },
    } as unknown as Parameters<typeof createScheduleFromTool>[0];

    await expect(
      createScheduleFromTool(deps, {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "thread-1",
        name: "Morning joke",
        prompt: "Tell a joke",
        schedule: { every: 1, unit: "minutes" },
      }),
    ).rejects.toThrow("deactivate failed");
  });

  it("scopes group list and cancel to the current thread without narrowing DMs", async () => {
    const findMany = vi.fn(async () => []);
    const findFirst = vi.fn(async () => null);
    const deps = {
      prisma: {
        user: noTimezone,
        routine: { findMany, findFirst, deleteMany: vi.fn(async () => ({ count: 1 })) },
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
    } as unknown as Parameters<typeof cancelScheduleFromTool>[0];

    await listSchedulesFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "group-thread-1",
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId: "ws-1",
          botId: "bot-1",
          userId: "user-1",
          threadId: "group-thread-1",
        },
      }),
    );

    const cancelled = await cancelScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "group-thread-1",
      routineId: "routine-1",
    });
    expect(cancelled).toEqual({ error: "Schedule not found." });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          spaceId: "ws-1",
          botId: "bot-1",
          userId: "user-1",
          threadId: "group-thread-1",
          id: "routine-1",
        },
      }),
    );

    findMany.mockClear();
    await listSchedulesFromTool(deps, { spaceId: "ws-1", botId: "bot-1", userId: "user-1" });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: "ws-1", botId: "bot-1", userId: "user-1" },
      }),
    );

    findFirst.mockClear();
    await cancelScheduleFromTool(deps, {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      routineId: "routine-1",
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { spaceId: "ws-1", botId: "bot-1", userId: "user-1", id: "routine-1" },
      }),
    );
  });
});

describe("schedule_create with a watch", () => {
  function deps() {
    const create = vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "routine-w",
      ...args.data,
    }));
    const enqueue = vi.fn(async () => undefined);
    return {
      create,
      enqueue,
      deps: {
        prisma: {
          user: { findUnique: vi.fn(async () => null) },
          connection: { findMany: vi.fn(async () => []) },
          bot: { findFirst: vi.fn(async () => ({ computer: null })) },
          routine: { create, findMany: noRoutines },
        },
        events: { append: vi.fn(async () => undefined) },
        jobs: { enqueue, cancel: vi.fn(async () => undefined) },
      } as unknown as Parameters<typeof createScheduleFromTool>[0],
    };
  }
  const base = {
    spaceId: "space-1",
    botId: "bot-1",
    userId: "user-1",
    threadId: "thread-1",
    name: "Brain check",
    prompt: "Summarize what changed",
  };

  it("creates an active routine with no schedule that checks right away", async () => {
    const { deps: d, create, enqueue } = deps();
    const result = await createScheduleFromTool(d, {
      ...base,
      schedule: { watch: { kind: "tool", tool: "brain_changed", args: { limit: 1 } } },
    });
    expect(result).toMatchObject({ ok: true, routineId: "routine-w" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        crons: [],
        active: true,
        watch: expect.objectContaining({ kind: "tool", everyMinutes: 15, loud: false }),
      }),
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects a team path escape before persisting", async () => {
    const { deps: d, create } = deps();
    vi.mocked(d.prisma.bot.findFirst).mockResolvedValue({ computer: { scope: "team" } } as never);
    const result = await createScheduleFromTool(d, {
      ...base,
      schedule: { watch: { kind: "files", paths: ["/etc"] } },
    });
    expect(result).toMatchObject({ error: expect.stringContaining("inside the bot's folder") });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a write tool before persisting", async () => {
    const { deps: d, create } = deps();
    d.connector = {
      discoverTools: vi.fn(async () => [
        { name: "send", readOnly: false, description: "Send", inputSchema: {} },
      ]),
    } as unknown as typeof d.connector;
    const result = await createScheduleFromTool(d, {
      ...base,
      schedule: { watch: { kind: "tool", tool: "send" } },
    });
    expect(result).toMatchObject({ error: expect.stringContaining("can change data") });
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a caller outside the bot owner boundary", async () => {
    const { deps: d, create } = deps();
    vi.mocked(d.prisma.bot.findFirst).mockResolvedValue(null);
    const result = await createScheduleFromTool(d, {
      ...base,
      schedule: { watch: { kind: "command", command: "echo changed" } },
    });
    expect(result).toMatchObject({ error: "Bot not found." });
    expect(d.prisma.bot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: base.botId, spaceId: base.spaceId, userId: base.userId, archivedAt: null },
      }),
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts the watch sent as JSON text", async () => {
    const { deps: d, create } = deps();
    const result = await createScheduleFromTool(d, {
      ...base,
      schedule: { watch: '{"kind":"files","paths":["inbox/"]}' },
    });
    expect(result).toMatchObject({ ok: true });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("refuses a watch combined with a schedule, or an invalid watch", async () => {
    const { deps: d, create } = deps();
    expect(
      await createScheduleFromTool(d, {
        ...base,
        schedule: { cron: "0 9 * * *", watch: { kind: "files", paths: ["inbox"] } },
      }),
    ).toHaveProperty("error");
    expect(
      await createScheduleFromTool(d, { ...base, schedule: { watch: { kind: "files" } } }),
    ).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("cancelScheduleFromTool", () => {
  it("deletes with the caller's scope and does not cancel the job when the row moved", async () => {
    const findFirst = vi.fn(async () => ({
      id: "routine-1",
      name: "Daily",
      botId: "bot-1",
      spaceId: "ws-1",
      userId: "user-1",
      threadId: "routine-thread-1",
    }));
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const executeRaw = vi.fn(async () => 1);
    const cancel = vi.fn(async () => undefined);
    const tx = { routine: { deleteMany }, $executeRaw: executeRaw };
    const deps = {
      prisma: {
        routine: { findFirst, deleteMany },
        $transaction: vi.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
      },
      events: { append: vi.fn(async () => undefined) },
      jobs: { enqueue: vi.fn(async () => undefined), cancel },
    } as unknown as Parameters<typeof cancelScheduleFromTool>[0];
    const input = {
      spaceId: "ws-1",
      botId: "bot-1",
      userId: "user-1",
      threadId: "group-thread-1",
      name: "Daily",
    };

    await expect(cancelScheduleFromTool(deps, input)).resolves.toEqual({
      ok: true,
      routineId: "routine-1",
      name: "Daily",
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "group-thread-1",
        id: "routine-1",
      },
    });
    expect(cancel).toHaveBeenCalledOnce();
    // Deleting the routine archives its own conversation in the same transaction.
    expect(executeRaw.mock.calls.some((call) => String(call[0]).includes('"archivedAt"'))).toBe(true);

    deleteMany.mockResolvedValueOnce({ count: 0 });
    cancel.mockClear();
    executeRaw.mockClear();
    await expect(cancelScheduleFromTool(deps, input)).resolves.toEqual({
      error: "Schedule not found.",
    });
    expect(cancel).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});

describe("command watch approval classification", () => {
  it("recognizes object and JSON command watches only", () => {
    const watch = { kind: "command", command: "echo changed" };
    expect(commandWatchFromTool(watch)).toBe("echo changed");
    expect(commandWatchFromTool(JSON.stringify(watch))).toBe("echo changed");
    expect(commandWatchFromTool({ kind: "files", paths: ["inbox"] })).toBeUndefined();
  });
});

describe("updateScheduleFromTool", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-20T00:11:59.999Z") }));
  afterEach(() => vi.useRealTimers());

  const weekly = {
    id: "routine-1",
    spaceId: "ws-1",
    botId: "bot-1",
    userId: "user-1",
    threadId: "thread-1",
    name: "Groceries",
    prompt: "Order the usual groceries",
    crons: ["0 10 * * 1"],
    timezone: "Europe/Berlin",
    active: true,
    watch: null,
    lastRunAt: null,
    nextRunAt: new Date("2026-10-26T09:00:00.000Z"),
  };

  function setup(row: Record<string, unknown> | null = weekly) {
    const findFirst = vi.fn(async () => row);
    const updateMany = vi.fn(async () => ({ count: row ? 1 : 0 }));
    const enqueue = vi.fn(async () => undefined);
    const cancel = vi.fn(async () => undefined);
    const append = vi.fn(async () => undefined);
    const executeRaw = vi.fn(async () => 1);
    const deps = {
      prisma: { routine: { findFirst, updateMany }, $executeRaw: executeRaw },
      events: { append },
      jobs: { enqueue, cancel },
    } as unknown as Parameters<typeof updateScheduleFromTool>[0];
    const update = (patch: Partial<Parameters<typeof updateScheduleFromTool>[1]>) =>
      updateScheduleFromTool(deps, {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "thread-1",
        routineId: "routine-1",
        schedule: {},
        ...patch,
      });
    return { findFirst, updateMany, enqueue, cancel, append, update, executeRaw };
  }

  it("edits the prompt in place and keeps the timing", async () => {
    const { updateMany, enqueue, append, update } = setup();
    const prompt = "Order the usual; if cheddar is out of stock, skip it";
    await expect(update({ prompt })).resolves.toEqual({
      ok: true,
      routineId: "routine-1",
      name: "Groceries",
      prompt,
      active: true,
      crons: ["0 10 * * 1"],
      nextRunAt: "2026-10-26T09:00:00.000Z",
      oneShot: false,
      timezone: "Europe/Berlin",
      schedule: "Every Monday at 10:00 AM",
      nextRun: "Monday, 2026-10-26 10:00 (UTC+01:00)",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        id: "routine-1",
        bot: { archivedAt: null },
      },
      // Only the prompt, so a run claimed meanwhile keeps its advance.
      data: { prompt },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ type: "routine.updated", threadId: "thread-1" }),
    );
  });

  it("moves the first run of the current repeat with startAt alone", async () => {
    const { updateMany, enqueue, update } = setup();
    const first = new Date("2026-11-02T09:00:00.000Z");
    await expect(update({ schedule: { startAt: "2026-11-02" } })).resolves.toMatchObject({
      ok: true,
      nextRunAt: first.toISOString(),
      nextRun: "Monday, 2026-11-02 10:00 (UTC+01:00)",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ crons: ["0 10 * * 1"], nextRunAt: first }),
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ availableAt: first }));
  });

  it.each([
    [
      "0 10 * * 1",
      "Europe/Berlin",
      "2026-11-16T09:00:00.000Z",
      "Europe/London",
      "2026-11-16T10:00:00.000Z",
    ],
    [
      "0 10 * * 1",
      "Europe/London",
      "2026-11-16T10:00:00.000Z",
      "Europe/Berlin",
      "2026-11-16T09:00:00.000Z",
    ],
    ["30 2 * * 0", "UTC", "2027-03-28T02:30:00.000Z", "Europe/Berlin", "2027-03-28T01:30:00.000Z"],
    [
      "0 * * * *",
      "Asia/Kolkata",
      "2026-11-02T00:30:00.000Z",
      "Europe/Berlin",
      "2026-11-02T01:00:00.000Z",
    ],
    [
      "0 * * * *",
      "Europe/Berlin",
      "2026-11-02T01:00:00.000Z",
      "Asia/Kolkata",
      "2026-11-01T20:30:00.000Z",
    ],
    [
      "0 */7 * * *",
      "Europe/Berlin",
      "2026-10-20T03:00:00.000Z",
      "Europe/London",
      "2026-10-20T03:00:00.000Z",
    ],
    [
      "0 0 */3 * *",
      "Europe/Berlin",
      "2026-11-02T23:00:00.000Z",
      "America/New_York",
      "2026-11-03T05:00:00.000Z",
    ],
  ])(
    "keeps the next run (%s) when only the timezone changes from %s",
    async (cron, from, next, to, moved) => {
      const { update } = setup({
        ...weekly,
        crons: [cron],
        timezone: from,
        nextRunAt: new Date(next),
      });
      await expect(update({ timezone: to })).resolves.toMatchObject({ ok: true, nextRunAt: moved });
    },
  );

  it("applies a timing change only if no run advanced the routine since the read", async () => {
    const { updateMany, enqueue, update } = setup();
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(update({ schedule: { startAt: "2026-11-02" } })).resolves.toEqual({
      error: "The schedule changed while saving. Call schedule_list and try again.",
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ active: true, nextRunAt: weekly.nextRunAt }),
      }),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("replaces the timing, turning a one-shot into a weekly routine", async () => {
    const { update } = setup({
      ...weekly,
      crons: [ONCE_ROUTINE_CRON],
      nextRunAt: new Date("2026-11-02T09:00:00.000Z"),
    });
    await expect(
      update({ schedule: { cron: "0 9 * * 1", startAt: "2026-11-02" }, timezone: "UTC" }),
    ).resolves.toMatchObject({
      ok: true,
      crons: ["0 9 * * 1"],
      oneShot: false,
      timezone: "UTC",
      nextRunAt: "2026-11-02T09:00:00.000Z",
    });
  });

  it("pauses with active false and cancels the wakeup", async () => {
    const { updateMany, cancel, enqueue, update } = setup();
    await expect(update({ active: false })).resolves.toMatchObject({
      ok: true,
      active: false,
      nextRunAt: null,
      nextRun: null,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false, nextRunAt: null }),
      }),
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("records a pause by the routine's own run and asks the run to say so", async () => {
    const { updateMany, update } = setup();
    const startedAt = new Date("2026-10-20T00:10:00.000Z");
    await expect(
      update({ active: false, ownRun: { routineId: "routine-1", runId: "run-7", startedAt } }),
    ).resolves.toMatchObject({ ok: true, active: false, pausedByThisRun: true, note: expect.stringContaining("paused") });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false, pausedByRunId: "run-7", pausedByRunAt: startedAt }),
      }),
    );
  });

  it("never names a run as the reason for a pause it did not make", async () => {
    const { updateMany, update } = setup();
    // A run of another routine (or a chat turn) pausing this routine.
    const result = await update({
      active: false,
      ownRun: { routineId: "routine-9", runId: "run-7", startedAt: new Date() },
    });
    expect(result).not.toHaveProperty("pausedByThisRun");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: false, pausedByRunId: null, pausedByRunAt: null }),
      }),
    );
  });

  it("clears the run that paused a routine when it is turned back on", async () => {
    const { updateMany, update } = setup({ ...weekly, active: false, nextRunAt: null });
    await update({ active: true });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ active: true, pausedByRunId: null, pausedByRunAt: null }),
      }),
    );
  });

  describe("moving a routine", () => {
    function moveSetup(place: { botId: string | null; groupId: string | null } | null, ownThread: string | null) {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const findThread = vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        where.id ? place : where.taskKey ? (ownThread ? { id: ownThread } : null) : { id: "main-thread-1" },
      );
      const executeRaw = vi.fn(async () => 1);
      const deps = {
        prisma: {
          routine: { findFirst: vi.fn(async () => weekly), updateMany },
          thread: { findFirst: findThread },
          $executeRaw: executeRaw,
        },
        events: { append: vi.fn(async () => undefined) },
        jobs: { enqueue: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) },
      } as unknown as Parameters<typeof updateScheduleFromTool>[0];
      const move = (patch: Partial<Parameters<typeof updateScheduleFromTool>[1]>) =>
        updateScheduleFromTool(deps, {
          spaceId: "ws-1", botId: "bot-1", userId: "user-1", threadId: "thread-1",
          routineId: "routine-1", schedule: {}, ...patch,
        });
      return { move, updateMany, findThread, executeRaw };
    }

    it("moves a routine from its own conversation to the main chat, keeping that conversation", async () => {
      const { move, updateMany, executeRaw } = moveSetup({ botId: null, groupId: null }, "thread-1");
      await expect(move({ runIn: "chat" })).resolves.toMatchObject({ ok: true, runIn: "chat" });
      expect(updateMany.mock.calls[0]![0]).toMatchObject({ data: { threadId: "main-thread-1" } });
      // Nothing is archived or renamed.
      expect(executeRaw).not.toHaveBeenCalled();
    });

    it("moves a main-chat routine back to its earlier conversation, or lets the next run create one", async () => {
      const back = moveSetup({ botId: "bot-1", groupId: null }, "own-thread-1");
      await expect(back.move({ runIn: "thread" })).resolves.toMatchObject({ ok: true, runIn: "thread" });
      expect(back.updateMany.mock.calls[0]![0]).toMatchObject({ data: { threadId: "own-thread-1" } });
      expect(back.findThread).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ taskKey: "routine:routine-1", taskBotId: "bot-1", botId: null, groupId: null }),
      }));
      const fresh = moveSetup({ botId: "bot-1", groupId: null }, null);
      await fresh.move({ runIn: "thread" });
      expect(fresh.updateMany.mock.calls[0]![0]).toMatchObject({ data: { threadId: null } });
    });

    it("refuses moving a group routine and changes nothing when it already runs there", async () => {
      const group = moveSetup({ botId: null, groupId: "group-1" }, null);
      for (const runIn of ["thread", "chat"] as const)
        await expect(group.move({ runIn })).resolves.toEqual({ error: RUN_IN_GROUP_ERROR });
      await expect(group.move({ runIn: "chat", scopeThreadId: "thread-1" })).resolves.toEqual({ error: RUN_IN_GROUP_ERROR });
      expect(group.updateMany).not.toHaveBeenCalled();
      const same = moveSetup({ botId: "bot-1", groupId: null }, null);
      await expect(same.move({ runIn: "chat" })).resolves.toEqual({ error: "Nothing to update." });
      expect(same.updateMany).not.toHaveBeenCalled();
    });
  });

  it("renames the routine's own conversation with the routine", async () => {
    const { executeRaw, update } = setup();
    await update({ name: "Weekly groceries" });
    const call = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(call[0].join("?")).toContain(`"titleSource" IS DISTINCT FROM 'user'`);
    expect(call.slice(1)).toEqual(expect.arrayContaining(["Weekly groceries", "routine:routine-1"]));
  });

  it("resumes a paused repeat from now", async () => {
    const { enqueue, update } = setup({ ...weekly, active: false, nextRunAt: null });
    await expect(update({ active: true })).resolves.toMatchObject({
      nextRunAt: "2026-10-26T09:00:00.000Z",
    });
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("does not touch another bot's or thread's routine", async () => {
    const { findFirst, updateMany, update } = setup(null);
    await expect(update({ prompt: "x", scopeThreadId: "group-thread-1" })).resolves.toEqual({
      error: "Schedule not found.",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        spaceId: "ws-1",
        botId: "bot-1",
        userId: "user-1",
        threadId: "group-thread-1",
        id: "routine-1",
        bot: { archivedAt: null },
      },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("returns timing errors without writing", async () => {
    const { updateMany, update } = setup();
    expect(await update({ schedule: { startAt: "2026-10-01" } })).toEqual({
      error: expect.stringMatching(/^startAt is in the past/),
    });
    expect(await update({ schedule: { runAt: "2026-10-19T10:00" } })).toEqual({
      error: expect.stringMatching(/^One-shot schedules must run in the future/),
    });
    expect(await update({})).toEqual({ error: "Nothing to update." });
    expect(await update({ prompt: "  " })).toEqual({ error: "prompt cannot be empty." });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps a watch's own interval", async () => {
    const { update } = setup({
      ...weekly,
      crons: [],
      watch: { kind: "files", paths: ["inbox"], everyMinutes: 15 },
    });
    await expect(update({ schedule: { cron: "0 9 * * *" } })).resolves.toEqual({
      error: "A watch checks on its own interval; cancel it and create a schedule.",
    });
    await expect(update({ name: "Inbox" })).resolves.toMatchObject({ ok: true, name: "Inbox" });
  });
});
