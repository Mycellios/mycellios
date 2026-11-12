import { notificationAllowed, type NotificationSettings, type ProductEvent } from "@rakazo/contracts";

// Memory only, keyed by authenticated account. Never reuse another account's policy.
const policies = new Map<string, NotificationSettings>();
export function rememberNotificationSettings(accountId: string, settings: NotificationSettings) {
  if (accountId) policies.set(accountId, settings);
}
export function forgetNotificationSettings(accountId: string) { policies.delete(accountId); }
export function accountNotificationSettings(accountId: string) { return policies.get(accountId); }
export function accountNotificationAllowed(
  accountId: string,
  botId: string | null | undefined,
  event: Pick<ProductEvent, "type" | "payload">,
  now = Date.now(),
) {
  const settings = policies.get(accountId);
  if (!settings) return false; // Do not bypass an unknown account opt-out while status loads.
  const failedBlock = event.type === "thread.message.created" && Array.isArray(event.payload.blocks) && event.payload.blocks.some((block: unknown) => Boolean(block && typeof block === "object" && "kind" in block && block.kind === "subagent" && "status" in block && block.status === "failed"));
  const kind = failedBlock || event.type === "run.failed" || event.type === "thread.subagent" && event.payload.status === "failed"
    ? "failure" : event.type === "computer.takeover.requested" ? "takeover"
    : ["thread.ask", "thread.choice", "run.waiting_input"].includes(event.type) ? "help" : "completion";
  return notificationAllowed(settings, botId ?? "", kind, now);
}
