import type { RoutineRunSource } from "@mycellios/contracts";
import { nextRoutineRunDateAcross } from "./cron.js";

/**
 * Every run started through routines.testRun (Test or Run in the app, a local script, a
 * mention in chat) carries this nonce prefix, so its run can be told apart from a scheduled one.
 */
export const ROUTINE_TEST_NONCE_PREFIX = "routine-test:";
const ROUTINE_SCRIPT_NONCE_PREFIX = `${ROUTINE_TEST_NONCE_PREFIX}local:`;
const ROUTINE_CHAT_NONCE_PREFIX = `${ROUTINE_TEST_NONCE_PREFIX}routine-mention:`;
const ROUTINE_TIMER_NONCE_PREFIX = "routine-timer:";

/** A routine run can report its own failure with a reason of at most this many characters. */
export const ROUTINE_FAILURE_REASON_MAX_LENGTH = 500;

/** Missed occurrences counted for one catch-up run; an outage longer than this shows the cap. */
export const ROUTINE_MISSED_COUNT_LIMIT = 1_000;

export function routineTestRunNonce(clientNonce: string): string {
  return `${ROUTINE_TEST_NONCE_PREFIX}${clientNonce}`;
}

/** The scheduled occurrence a recurring timer run was created for, if it is one. */
export function routineTimerScheduledAt(
  routineId: string,
  clientNonce: string | null | undefined,
): Date | undefined {
  const prefix = `${ROUTINE_TIMER_NONCE_PREFIX}${routineId}:`;
  if (!clientNonce?.startsWith(prefix)) return undefined;
  const scheduledFor = new Date(clientNonce.slice(prefix.length));
  return Number.isFinite(scheduledFor.getTime()) ? scheduledFor : undefined;
}

type RoutineRunProvenance = {
  trigger: string;
  clientNonce: string | null;
  retryOfRunId?: string | null;
};

/**
 * What started a routine run, read from columns every run already has. Older runs keep the
 * label their provenance allows: a test run without a nonce reads as scheduled.
 */
export function routineRunSource(
  run: RoutineRunProvenance,
  routine?: { watch: unknown } | null,
): RoutineRunSource {
  const nonce = run.clientNonce ?? "";
  if (run.trigger === "webhook") return nonce.startsWith("github:") ? "github" : "webhook";
  if (run.retryOfRunId) return "retry";
  if (nonce.startsWith(ROUTINE_SCRIPT_NONCE_PREFIX)) return "script";
  if (nonce.startsWith(ROUTINE_CHAT_NONCE_PREFIX)) return "chat";
  if (nonce.startsWith(ROUTINE_TEST_NONCE_PREFIX)) return "manual";
  if (nonce.startsWith(ROUTINE_TIMER_NONCE_PREFIX)) return "schedule";
  return routine?.watch != null ? "watch" : "schedule";
}

/**
 * A person asked for this run (Test or Run, or a mention in chat) and is waiting for its
 * answer, so it never ends quiet. Scheduled, watch, webhook and script runs may.
 */
export function isPersonRequestedRoutineRun(run: RoutineRunProvenance): boolean {
  if (run.trigger !== "routine") return false;
  const source = routineRunSource(run);
  return source === "manual" || source === "chat";
}

/**
 * Occurrences of a recurring schedule after `scheduledAt` and up to `now`. A wake-up that comes
 * late runs once for `scheduledAt` and moves past these, so they are the runs that did not
 * happen. Bounded by ROUTINE_MISSED_COUNT_LIMIT.
 */
export function missedRoutineOccurrences(
  crons: readonly string[],
  scheduledAt: Date,
  now: Date,
  timezone: string,
): number {
  let count = 0;
  let cursor = scheduledAt;
  while (count < ROUTINE_MISSED_COUNT_LIMIT) {
    const next = nextRoutineRunDateAcross([...crons], scheduledAt, cursor, timezone);
    if (!next || next.getTime() > now.getTime() || next.getTime() <= cursor.getTime()) break;
    count += 1;
    cursor = next;
  }
  return count;
}
