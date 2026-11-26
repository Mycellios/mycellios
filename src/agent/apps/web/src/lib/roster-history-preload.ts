/** Background history warm-up for the first visible Micos of the open Space. */
export const ROSTER_HISTORY_PRELOAD_LIMIT = 4;
/** Hovering this long counts as intent; a pointer passing over the list does not. */
export const ROSTER_HOVER_INTENT_MS = 120;

export type RosterHistoryTarget = [botId: string, taskThreadId: string | null];

type RosterRow =
  | { kind: "bot"; chat: { id: string; status?: string; waitingTaskThreadId?: string | null } }
  | { kind: "group"; chat: { id: string } };

/**
 * The conversations a roster click would open, in sidebar order: only the
 * current Space (another Space is an auth boundary), never the open chat, and
 * a waiting Mico's pending task thread, as the click opens it.
 */
export function rosterHistoryPreloads(
  groups: readonly { spaceId: string; bots: readonly RosterRow[] }[],
  spaceId: string | null | undefined,
  activeBotId: string | undefined,
  limit = ROSTER_HISTORY_PRELOAD_LIMIT,
): RosterHistoryTarget[] {
  if (!spaceId || limit <= 0) return [];
  const targets: RosterHistoryTarget[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    if (group.spaceId !== spaceId) continue;
    for (const row of group.bots) {
      if (row.kind !== "bot" || row.chat.id === activeBotId || seen.has(row.chat.id)) continue;
      seen.add(row.chat.id);
      const waitingThread = row.chat.status === "waiting_input" ? row.chat.waitingTaskThreadId ?? null : null;
      targets.push([row.chat.id, waitingThread]);
      if (targets.length === limit) return targets;
    }
  }
  return targets;
}
