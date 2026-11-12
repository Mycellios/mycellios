import type { ThreadMessage } from "@rakazo/contracts";

/** Join presentation only; never merge transcript records or their actions. */
export function joinMessageBubbles(previous: ThreadMessage | undefined, current: ThreadMessage | undefined, boundary = false): boolean {
  if (!previous || !current || boundary || previous.threadId !== current.threadId || previous.role !== current.role) return false;
  if (current.role !== "bot" && current.role !== "user") return false;
  if (previous.botId !== current.botId || previous.callId || current.callId || previous.replyToMessageId || current.replyToMessageId) return false;
  const plain = (message: ThreadMessage) => message.blocks.some(b => (b.kind === "text" || b.kind === "progress") && !("activity" in b && b.activity) && b.text.trim()) && message.blocks.every(b => b.kind === "text" || b.kind === "progress" || b.kind === "steps");
  if (!plain(previous) || !plain(current)) return false;
  const distance = Date.parse(current.createdAt) - Date.parse(previous.createdAt);
  return Number.isFinite(distance) && distance >= 0 && distance < 5 * 60_000;
}
