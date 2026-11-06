import type { InboxTask } from "@rakazo/contracts";
export type TaskSection = "needsYou" | "working" | "waiting" | "unread" | "read" | "archived";
export const TASK_SECTIONS: TaskSection[] = [
  "needsYou",
  "working",
  "waiting",
  "unread",
  "read",
  "archived",
];
export function taskSection(item: InboxTask): TaskSection {
  if (item.archivedAt && !taskIsActive(item)) return "archived";
  if (["waiting_input", "waiting_takeover", "failed"].includes(item.status ?? ""))
    return "needsYou";
  if (["leased", "running"].includes(item.status ?? "")) return "working";
  if (item.status === "queued" || item.status === null) return "waiting";
  return item.unread ? "unread" : "read";
}
export function taskIsActive(item: InboxTask) {
  return [
    "queued",
    "leased",
    "running",
    "waiting_input",
    "waiting_takeover",
  ].includes(item.status ?? "");
}
