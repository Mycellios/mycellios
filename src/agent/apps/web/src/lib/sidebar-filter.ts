import { useSyncExternalStore } from "react";
import { rosterWorkStatusLabel } from "./roster-status";

/**
 * A device's sidebar filter: which kinds of chat to show (Micos, groups), which states
 * (unread, working) and which folders. Empty lists mean "any"; the choices inside one list
 * widen the result, the lists narrow it together. Nothing here changes saved folders or order.
 */
export type SidebarFilter = Readonly<{
  kinds: readonly ("bot" | "group")[];
  states: readonly ("unread" | "working")[];
  folders: readonly string[];
}>;

export const EMPTY_SIDEBAR_FILTER: SidebarFilter = Object.freeze({ kinds: [], states: [], folders: [] });
export const SIDEBAR_FILTER_KEY = "mycellios.sidebar-filter.v1";

type FilterRow = {
  kind: "bot" | "group";
  chat: {
    status?: string;
    unread?: boolean;
    sectionId?: string | null;
    conversations?: { unread: number; working: number } | null;
    members?: readonly { status?: string }[];
  };
};

const unique = <T extends string>(value: unknown, allowed?: readonly T[]): T[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is T => typeof item === "string" && item.length > 0 && item.length <= 200
      && (!allowed || allowed.includes(item as T))))]
    : [];

export function parseSidebarFilter(raw: string | null): SidebarFilter {
  try {
    const value = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (!value || typeof value !== "object") return EMPTY_SIDEBAR_FILTER;
    return {
      kinds: unique(value.kinds, ["bot", "group"] as const),
      states: unique(value.states, ["unread", "working"] as const),
      folders: unique<string>(value.folders).slice(0, 100),
    };
  } catch { return EMPTY_SIDEBAR_FILTER; }
}

export const sidebarFilterActive = (filter: SidebarFilter) =>
  filter.kinds.length > 0 || filter.states.length > 0 || filter.folders.length > 0;

export function toggleSidebarFilter<K extends keyof SidebarFilter>(filter: SidebarFilter, key: K, value: SidebarFilter[K][number]): SidebarFilter {
  const list = filter[key] as readonly string[];
  const next = list.includes(value) ? list.filter(item => item !== value) : [...list, value];
  return { ...filter, [key]: next };
}

const isWorking = (status?: string) => Boolean(status && rosterWorkStatusLabel(status));

/** Whether one roster row passes the filter. `folders` holds the chosen folders and everything inside them. */
export function rowMatchesSidebarFilter(row: FilterRow, filter: SidebarFilter, folders?: ReadonlySet<string>): boolean {
  if (filter.kinds.length && !filter.kinds.includes(row.kind)) return false;
  if (filter.states.length) {
    const unread = Boolean(row.chat.unread) || (row.chat.conversations?.unread ?? 0) > 0;
    const working = row.kind === "bot"
      ? isWorking(row.chat.status) || (row.chat.conversations?.working ?? 0) > 0
      : (row.chat.members ?? []).some(member => isWorking(member.status));
    if (!filter.states.some(state => state === "unread" ? unread : working)) return false;
  }
  if (folders?.size && !(row.chat.sectionId && folders.has(row.chat.sectionId))) return false;
  return true;
}

/**
 * Keeps only the rows that pass, and only the sections that still hold one. With no filter the
 * groups come back unchanged. Folder ids no longer known are ignored, so a deleted folder
 * cannot hide everything.
 */
export function filterSidebarGroups<T extends { bots: readonly FilterRow[] }>(
  groups: readonly T[],
  filter: SidebarFilter,
  folderTree: readonly { id: string; ancestorIds: readonly string[] }[] = [],
): T[] {
  if (!sidebarFilterActive(filter)) return [...groups];
  const known = filter.folders.filter(id => folderTree.some(folder => folder.id === id));
  const folders = new Set(known);
  for (const folder of folderTree) if (folder.ancestorIds.some(id => folders.has(id))) folders.add(folder.id);
  return groups.flatMap(group => {
    const bots = group.bots.filter(row => rowMatchesSidebarFilter(row, filter, folders));
    return bots.length ? [{ ...group, bots }] : [];
  });
}

// --- Saved per device.

let previousRaw: string | null | undefined;
let previous: SidebarFilter = EMPTY_SIDEBAR_FILTER;
/** A choice this browser could not store still applies until the page reloads. */
let unsaved: string | null = null;
const listeners = new Set<() => void>();

export function readSidebarFilter(): SidebarFilter {
  let raw: string | null = unsaved;
  if (raw === null) {
    try { raw = localStorage.getItem(SIDEBAR_FILTER_KEY); } catch { return previous; }
  }
  if (raw !== previousRaw) { previousRaw = raw; previous = parseSidebarFilter(raw); }
  return previous;
}

export function writeSidebarFilter(filter: SidebarFilter) {
  const raw = JSON.stringify({ kinds: filter.kinds, states: filter.states, folders: filter.folders });
  try { localStorage.setItem(SIDEBAR_FILTER_KEY, raw); unsaved = null; } catch { unsaved = raw; }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const sync = (event: StorageEvent) => { if (event.key === null || event.key === SIDEBAR_FILTER_KEY) listener(); };
  window.addEventListener("storage", sync);
  return () => { listeners.delete(listener); window.removeEventListener("storage", sync); };
}

export function useSidebarFilter(): SidebarFilter {
  return useSyncExternalStore(subscribe, readSidebarFilter, () => EMPTY_SIDEBAR_FILTER);
}
