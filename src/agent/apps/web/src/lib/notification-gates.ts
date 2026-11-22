import type { ProductEvent, Run } from "@mycellios/contracts";

/** Turns another Mico started: a message to this Mico or a task it handed over. */
const TEAMMATE_TRIGGERS = new Set(["bot_message", "delegated_task"]);
const WORKING = new Set(["queued", "leased", "running"]);

type LiveEvent = Pick<ProductEvent, "type" | "runId" | "payload">;

function blocksOf(event: LiveEvent): unknown[] {
  return event.type === "thread.message.created" && Array.isArray(event.payload.blocks) ? event.payload.blocks : [];
}

function hasFailedHelper(event: LiveEvent): boolean {
  return blocksOf(event).some((block) => Boolean(block && typeof block === "object" &&
    (block as { kind?: unknown }).kind === "subagent" && (block as { status?: unknown }).status === "failed"));
}

/** A finished reply or the end of a turn, as opposed to a question, approval or failure. */
export function isCompletionEvent(event: LiveEvent): boolean {
  return event.type === "run.completed" ||
    (event.type === "thread.message.created" && event.payload.role === "bot" && !hasFailedHelper(event));
}

/**
 * Remembers which live runs a teammate started, from their start event or the message that
 * woke them. Their completions stay quiet (no sound, no alert) but still count as unread.
 */
export function createTeammateRunTracker(limit = 200) {
  const runs = new Set<string>();
  const add = (runId: string | null | undefined) => {
    if (!runId) return;
    runs.add(runId);
    if (runs.size > limit) runs.delete(runs.values().next().value!);
  };
  return {
    seed(list: ReadonlyArray<Pick<Run, "id" | "trigger">> | null | undefined) {
      for (const run of list ?? []) if (TEAMMATE_TRIGGERS.has(run.trigger)) add(run.id);
    },
    observe(event: LiveEvent) {
      if (event.type === "run.started" && TEAMMATE_TRIGGERS.has(String(event.payload.trigger ?? ""))) add(event.runId);
      else if (
        event.type === "thread.message.created" && event.payload.role === "user" &&
        blocksOf(event).some((block) => Boolean(block && typeof block === "object" &&
          (block as { kind?: unknown }).kind === "bot_message_received"))
      ) add(event.runId);
    },
    /** True for a completion of a teammate-started turn; failures and requests still alert. */
    quiet(event: LiveEvent): boolean {
      return Boolean(event.runId && runs.has(event.runId) && isCompletionEvent(event));
    },
  };
}

/** Another member turn in the group is still working, so this one is not the last. */
export function groupWorkStillRunning(
  runs: ReadonlyArray<Pick<Run, "id" | "status">>,
  runId: string | null | undefined,
): boolean {
  return runs.some((run) => run.id !== runId && WORKING.has(run.status));
}

/**
 * A group alerts once per request: replies are held until the last member turn ends, then the
 * latest held reply is released. Failed helpers, questions and approvals pass straight through.
 */
export function createGroupNoticeGate<T extends LiveEvent>(handoffWindowMs = 120_000) {
  let held: T | undefined;
  // A handoff queues the next member before its run starts, so the snapshot cannot show it yet.
  let handoffs: number[] = [];
  return (event: T, stillRunning: boolean, now = Date.now()): { hold: boolean; release?: T } => {
    handoffs = handoffs.filter((at) => now - at < handoffWindowMs);
    if (event.type === "group.handoff") handoffs.push(now);
    if (event.type === "run.started") handoffs.shift();
    if (event.type === "thread.message.created" && isCompletionEvent(event)) {
      held = event;
      return { hold: true };
    }
    if (event.type === "run.completed") {
      if (stillRunning || handoffs.length > 0) return { hold: true };
      const release = held;
      held = undefined;
      return { hold: false, ...(release ? { release } : {}) };
    }
    return { hold: false };
  };
}
