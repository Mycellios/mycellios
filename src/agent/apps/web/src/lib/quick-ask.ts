export type QuickAskBot = {
  id: string;
  name: string;
  archivedAt: string | null;
  pinned: boolean;
};

const BOT_ID = /^[a-zA-Z0-9_-]{1,160}$/;

export function chooseQuickAskBot(
  bots: readonly QuickAskBot[],
  requestedId: string | null,
): QuickAskBot | null {
  const open = bots.filter((bot) => bot.archivedAt === null && BOT_ID.test(bot.id));
  if (requestedId && BOT_ID.test(requestedId)) {
    const requested = open.find((bot) => bot.id === requestedId);
    if (requested) return requested;
  }
  return open.find((bot) => bot.pinned) ?? open[0] ?? null;
}
