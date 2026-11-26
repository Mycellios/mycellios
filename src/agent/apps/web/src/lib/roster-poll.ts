import type { Bot } from "@mycellios/contracts";

/** While a Mico works, the roster follows it closely. */
export const ROSTER_POLL_ACTIVE_MS = 5_000;
/**
 * With nothing working, a slower check is enough: the person's own sends, answers and
 * navigation refresh the roster directly, and the open chat has its own live stream.
 * The roster read is one of the costliest on the API, so both rates stay modest.
 */
export const ROSTER_POLL_IDLE_MS = 20_000;

const WORKING_STATUSES = new Set(["queued", "leased", "running"]);

/** How long to wait before the next roster refresh, from the roster just shown. */
export function rosterPollInterval(
  bots: readonly Pick<Bot, "status" | "conversations">[],
): number {
  const working = bots.some(
    (bot) => WORKING_STATUSES.has(bot.status) || (bot.conversations?.working ?? 0) > 0,
  );
  return working ? ROSTER_POLL_ACTIVE_MS : ROSTER_POLL_IDLE_MS;
}
