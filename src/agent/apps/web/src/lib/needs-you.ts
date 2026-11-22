/**
 * The "Needs you" group at the top of the sidebar: Micos whose main chat waits for an answer or
 * a takeover, and Micos with conversations that wait for the person. It is a shortcut list; the
 * rows stay in their folders and the saved order never changes.
 */
export type NeedsYouAction = "answer" | "takeover" | "review";

export type NeedsYouEntry = Readonly<{
  key: string;
  botId: string;
  spaceId: string;
  name: string;
  color: string;
  status: string;
  action: NeedsYouAction;
  /** Waiting conversations, for a review entry. */
  count: number;
}>;

type NeedsYouBot = {
  id: string;
  spaceId: string;
  name: string;
  color: string;
  status: string;
  conversations?: { waiting: number } | null;
};

export function needsYouEntries(spaces: readonly { bots: readonly NeedsYouBot[] }[]): NeedsYouEntry[] {
  const entries: NeedsYouEntry[] = [];
  const seen = new Set<string>();
  for (const space of spaces) {
    for (const bot of space.bots) {
      if (seen.has(bot.id)) continue;
      seen.add(bot.id);
      const base = { botId: bot.id, spaceId: bot.spaceId, name: bot.name, color: bot.color, status: bot.status };
      if (bot.status === "waiting_input") entries.push({ ...base, key: `${bot.id}:answer`, action: "answer", count: 0 });
      else if (bot.status === "waiting_takeover") entries.push({ ...base, key: `${bot.id}:takeover`, action: "takeover", count: 0 });
      const waiting = bot.conversations?.waiting ?? 0;
      if (waiting > 0) entries.push({ ...base, key: `${bot.id}:review`, action: "review", count: waiting });
    }
  }
  return entries;
}

/** Where an entry's action leads: the chat with its question, or the main chat whose cards mirror the conversations. */
export function needsYouPath(entry: Pick<NeedsYouEntry, "botId" | "action">): string {
  const base = `/app/${encodeURIComponent(entry.botId)}`;
  return entry.action === "answer" ? `${base}?respond=1` : base;
}
