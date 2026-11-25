import { describe, expect, it } from "vitest";
import {
  isPersonRequestedRoutineRun,
  missedRoutineOccurrences,
  ROUTINE_MISSED_COUNT_LIMIT,
  ROUTINE_TEST_EVENT_NONCE_PREFIX,
  routineRunSource,
  routineTestRunNonce,
  routineTimerScheduledAt,
} from "./routine-runs.js";

const run = (trigger: string, clientNonce: string | null, retryOfRunId: string | null = null) => ({
  trigger,
  clientNonce,
  retryOfRunId,
});

describe("routineRunSource", () => {
  it("reads what started a run from the columns every run has", () => {
    expect(routineRunSource(run("routine", "routine-timer:r1:2026-11-22T08:00:00.000Z"))).toBe(
      "schedule",
    );
    expect(routineRunSource(run("routine", routineTestRunNonce("abc")))).toBe("manual");
    expect(routineRunSource(run("routine", routineTestRunNonce("local:n1")))).toBe("script");
    expect(routineRunSource(run("routine", routineTestRunNonce("routine-mention:n2:r1")))).toBe(
      "chat",
    );
    expect(routineRunSource(run("webhook", "webhook:bot:digest"))).toBe("webhook");
    expect(routineRunSource(run("webhook", null))).toBe("webhook");
    expect(routineRunSource(run("webhook", "github:bot:digest"))).toBe("github");
    // A signed routine event, and the sample one a person sends from the editor.
    expect(routineRunSource(run("webhook", "routine-event:r1:digest"))).toBe("webhook");
    expect(routineRunSource(run("webhook", `${ROUTINE_TEST_EVENT_NONCE_PREFIX}r1:digest`))).toBe("manual");
    expect(routineRunSource(run("routine", null, "failed-run"))).toBe("retry");
    expect(routineRunSource(run("routine", null))).toBe("schedule");
    expect(routineRunSource(run("routine", null), { watch: { kind: "files" } })).toBe("watch");
  });

  it("treats only a person's Test, Run or chat mention as person-requested", () => {
    expect(isPersonRequestedRoutineRun(run("routine", routineTestRunNonce("abc")))).toBe(true);
    expect(
      isPersonRequestedRoutineRun(run("routine", routineTestRunNonce("routine-mention:n:r"))),
    ).toBe(true);
    expect(isPersonRequestedRoutineRun(run("routine", routineTestRunNonce("local:n")))).toBe(false);
    expect(
      isPersonRequestedRoutineRun(run("routine", "routine-timer:r1:2026-11-22T08:00:00.000Z")),
    ).toBe(false);
    expect(isPersonRequestedRoutineRun(run("webhook", routineTestRunNonce("abc")))).toBe(false);
    expect(isPersonRequestedRoutineRun(run("user", null))).toBe(false);
  });
});

describe("routineTimerScheduledAt", () => {
  it("reads the occurrence of its own routine's timer nonce only", () => {
    expect(
      routineTimerScheduledAt("r1", "routine-timer:r1:2026-11-22T08:00:00.000Z")?.toISOString(),
    ).toBe("2026-11-22T08:00:00.000Z");
    expect(
      routineTimerScheduledAt("r2", "routine-timer:r1:2026-11-22T08:00:00.000Z"),
    ).toBeUndefined();
    expect(routineTimerScheduledAt("r1", "routine-timer:r1:not-a-date")).toBeUndefined();
    expect(routineTimerScheduledAt("r1", null)).toBeUndefined();
  });
});

describe("missedRoutineOccurrences", () => {
  const due = new Date("2026-11-20T08:00:00.000Z");
  it("counts the occurrences due after the scheduled one, up to now", () => {
    expect(
      missedRoutineOccurrences(["0 8 * * *"], due, new Date("2026-11-22T09:30:00.000Z"), "UTC"),
    ).toBe(2);
    expect(
      missedRoutineOccurrences(["0 8 * * *"], due, new Date("2026-11-20T08:05:00.000Z"), "UTC"),
    ).toBe(0);
    expect(
      missedRoutineOccurrences(["*/15 * * * *"], due, new Date("2026-11-20T09:00:00.000Z"), "UTC"),
    ).toBe(4);
  });

  it("keeps a long outage bounded", () => {
    expect(
      missedRoutineOccurrences(["* * * * *"], due, new Date("2026-11-22T08:00:00.000Z"), "UTC"),
    ).toBe(ROUTINE_MISSED_COUNT_LIMIT);
  });

  it("counts nothing for schedules without a recurring occurrence", () => {
    expect(missedRoutineOccurrences([], due, new Date("2026-11-22T08:00:00.000Z"), "UTC")).toBe(0);
  });
});
