import type { InboxTask } from "@mycellios/contracts";
export type TaskSection = "pinned" | "needsYou" | "newReplies" | "working" | "waiting" | "pending" | "archived";
export const TASK_SECTIONS: TaskSection[] = [
  "pinned",
  "needsYou",
  "newReplies",
  "working",
  "waiting",
  "pending",
  "archived",
];
export function taskSection(item: InboxTask): TaskSection {
  if (item.archivedAt && !taskIsActive(item)) return "archived";
  if(item.pinned && !item.archivedAt)return "pinned";
  if (item.remindAt && Date.parse(item.remindAt)<=Date.now()) return "needsYou";
  if (["waiting_input", "waiting_takeover", "failed"].includes(item.status ?? ""))
    return "needsYou";
  if (["leased", "running"].includes(item.status ?? "")) return "working";
  if (item.status === "queued") return "waiting";
  if(item.status === "completed" && item.unread)return "newReplies";
  return "pending";
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
