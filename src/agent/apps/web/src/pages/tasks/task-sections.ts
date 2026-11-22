import type { InboxTask } from "@mycellios/contracts";
export type TaskSection =
  | "pinned"
  | "needsYou"
  | "newReplies"
  | "working"
  | "waiting"
  | "pending"
  | "archived";
export const TASK_SECTIONS: TaskSection[] = [
  "pinned",
  "needsYou",
  "newReplies",
  "working",
  "waiting",
  "pending",
  "archived",
];
/** How a conversation that is not working now ended its last turn; null when it never finished one. */
export type TaskOutcome = "answered" | "failed" | "stopped";
/** What a row says about a conversation, and the tone its status takes. */
export type TaskTone = "danger" | "attention" | "reply" | null;

export function taskSection(item: InboxTask): TaskSection {
  if (item.archivedAt && !taskIsActive(item)) return "archived";
  if (item.pinned && !item.archivedAt) return "pinned";
  if (taskReminderDue(item)) return "needsYou";
  if (item.status === "waiting_input" || item.status === "waiting_takeover") return "needsYou";
  if (item.status === "leased" || item.status === "running") return "working";
  if (item.status === "queued") return "waiting";
  const outcome = taskOutcome(item);
  if (outcome === "failed") return "needsYou";
  // A conversation that has not finished a turn yet waits to start; it has nothing to continue.
  if (!outcome) return "waiting";
  if (outcome === "answered" && item.unread) return "newReplies";
  return "pending";
}

/**
 * The conversation's own record of its last turn comes first: work in the background never
 * changes it. Older servers do not send it, so the latest run stands in for it there.
 */
export function taskOutcome(item: InboxTask): TaskOutcome | null {
  if (taskIsActive(item)) return null;
  const outcome =
    item.outcome ??
    (item.status === "completed"
      ? "completed"
      : item.status === "failed"
        ? "failed"
        : item.status === "cancelled"
          ? "interrupted"
          : null);
  return outcome === "completed"
    ? "answered"
    : outcome === "failed"
      ? "failed"
      : outcome === "interrupted"
        ? "stopped"
        : null;
}

export function taskReminderDue(item: InboxTask, now = Date.now()) {
  return Boolean(item.remindAt && Date.parse(item.remindAt) <= now);
}

/**
 * Amber when the person is needed (a question, a takeover or a due reminder), red for a failed or
 * stopped conversation, blue for a reply not read yet. The status text always says it in words.
 */
export function taskTone(item: InboxTask): TaskTone {
  if (taskReminderDue(item)) return "attention";
  if (item.status === "waiting_input" || item.status === "waiting_takeover") return "attention";
  const outcome = taskOutcome(item);
  if (outcome === "failed" || outcome === "stopped") return "danger";
  if (outcome === "answered" && item.unread) return "reply";
  return null;
}

export function taskIsActive(item: InboxTask) {
  return ["queued", "leased", "running", "waiting_input", "waiting_takeover"].includes(
    item.status ?? "",
  );
}
