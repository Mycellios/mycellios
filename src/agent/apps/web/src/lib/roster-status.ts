import { t } from "@lingui/core/macro";

export function rosterHasUndismissedRunError(
  runErrorId: string | null | undefined,
  dismissedRunErrorIds: ReadonlySet<string>,
): boolean {
  return Boolean(runErrorId && !dismissedRunErrorIds.has(runErrorId));
}

/** Short sidebar label while a bot is queued, starting, or running. Null keeps the message preview. */
export function rosterWorkStatusLabel(status: string): string | null {
  switch (status) {
    case "queued":
      return t`Waiting in line…`;
    case "leased":
      return t`Starting…`;
    case "running":
      return t`Working…`;
    default:
      return null;
  }
}

/** Compact rows keep actionable status visible in place of the message preview. */
export function compactRosterStatusLabel(status: string): string | null {
  const workStatus = rosterWorkStatusLabel(status);
  if (workStatus) return workStatus;
  switch (status) {
    case "waiting_input":
      return t`Needs an answer`;
    case "waiting_takeover":
      return t`Needs you`;
    case "failed":
      return t`Error`;
    default:
      return null;
  }
}

/** The roster facts a row's one signal is chosen from. */
export type RosterSignalInput = {
  status: string;
  unread?: boolean;
  unreadCount?: number;
  conversations?: { unread: number; waiting: number; working: number } | null;
};

/**
 * The one thing a roster row signals, most urgent first: the main chat waits for an answer or
 * a takeover, a conversation waits for the person, a failure, work in progress (main chat or a
 * conversation), unread main-chat replies, then replies only in conversations.
 */
export type RosterSignal =
  | "answer"
  | "takeover"
  | "conversation-waiting"
  | "error"
  | "working"
  | "unread"
  | "conversation-unread";

export function rosterRowSignal(chat: RosterSignalInput, hasError = false): RosterSignal | null {
  if (chat.status === "waiting_input") return "answer";
  if (chat.status === "waiting_takeover") return "takeover";
  if ((chat.conversations?.waiting ?? 0) > 0) return "conversation-waiting";
  if (hasError || chat.status === "failed") return "error";
  if (rosterWorkStatusLabel(chat.status) || (chat.conversations?.working ?? 0) > 0) return "working";
  if (chat.unread) return "unread";
  if ((chat.conversations?.unread ?? 0) > 0) return "conversation-unread";
  return null;
}

/** The number on an unread badge; the server stops counting at 100. */
export function unreadBadgeText(count: number | undefined): string | null {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** A row's state line when its main chat is idle but one of its conversations is not. */
export function rosterConversationStatusLabel(chat: RosterSignalInput): string | null {
  if (chat.status !== "idle") return null;
  if ((chat.conversations?.waiting ?? 0) > 0) return t`A conversation needs you`;
  if ((chat.conversations?.working ?? 0) > 0) return t`Working in a conversation…`;
  return null;
}
