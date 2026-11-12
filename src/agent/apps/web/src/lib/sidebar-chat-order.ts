export type SidebarChatOrder = "manual" | "unread-group" | "unread-first";
type Row = { chat: { unread?: boolean; pinned?: boolean; status?: string; updatedAt: string } };
const needsAnswer = (row: Row) => ["waiting_input", "waiting_takeover"].includes(row.chat.status ?? "");
const activity = (row: Row) => Date.parse(row.chat.updatedAt) || 0;

/** Presentation only: no saved folder, pin or manual order changes. */
export function orderSidebarChats<T extends { key: string; spaceId: string; bots: Row[] }>(
  groups: readonly T[], mode: SidebarChatOrder, unreadLabel: string,
): T[] {
  if (mode === "manual") return [...groups];
  if (mode === "unread-first") return groups.map(group => ({ ...group, bots: [...group.bots].sort((a, b) =>
    Number(Boolean(b.chat.pinned)) - Number(Boolean(a.chat.pinned)) ||
    Number(needsAnswer(b)) - Number(needsAnswer(a)) ||
    Number(Boolean(b.chat.unread)) - Number(Boolean(a.chat.unread)) || activity(b) - activity(a),
  ) }));
  const moved = (row: Row) => row.chat.unread && !row.chat.pinned && !needsAnswer(row);
  const unreadBySpace = new Map<string, Row[]>();
  for (const group of groups) {
    const unread = unreadBySpace.get(group.spaceId) ?? [];
    unread.push(...group.bots.filter(moved)); unreadBySpace.set(group.spaceId, unread);
  }
  const inserted = new Set<string>();
  return groups.flatMap(group => {
    const result: T[] = [];
    const unread = unreadBySpace.get(group.spaceId) ?? [];
    const pinnedSection = group.key === "pinned" || group.key.endsWith(":pinned");
    if (unread.length && !inserted.has(group.spaceId) && !pinnedSection) {
      inserted.add(group.spaceId);
      result.push({ ...group, key: `space:${group.spaceId}:unread`, title: unreadLabel, subtitle: undefined,
        sectionId: null, emptySpaceId: undefined, canOpenSpaceSettings: false, canRenameSpace: false, canDeleteSpace: false,
        bots: [...unread].sort((a, b) => activity(b) - activity(a)),
      });
    }
    result.push({ ...group, bots: group.bots.filter(row => !moved(row)) });
    return result;
  });
}
