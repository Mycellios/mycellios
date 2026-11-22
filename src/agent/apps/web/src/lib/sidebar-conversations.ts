import { useEffect, useState, useSyncExternalStore } from "react";
import type { RpcClient } from "./rpc";
import {
  type ConversationRow, conversationStatus, isClosedConversation, pickerConversations,
  useConversationRows, writeConversationRows,
} from "./thread-tabs";

/** Recent conversations a sidebar row shows below the ones that need a look, before "Show more". */
export const SIDEBAR_RECENT_CONVERSATIONS = 3;

/**
 * What an expanded Mico row lists: every open conversation that needs a look (working, waiting,
 * failed or with an unread reply) and the most recent of the others; the rest stay behind
 * "Show N more" until `all`.
 */
export function sidebarConversationRows(rows: readonly ConversationRow[], all = false) {
  const open = pickerConversations(rows).open;
  const needLook = open.filter(row => conversationStatus(row) !== null);
  const others = open.filter(row => conversationStatus(row) === null);
  const recent = all ? others : others.slice(0, SIDEBAR_RECENT_CONVERSATIONS);
  return { needLook, recent, hidden: others.length - recent.length, total: open.length };
}

/** The tabs' rows leave project sessions to their project; the sidebar does the same. */
export const sidebarListedRows = (rows: readonly { projectKey?: string }[]) =>
  rows.filter(row => !row.projectKey?.startsWith("project:"));

/** The same key the Mico's tabs use, so the list is shared. */
export const micoConversationScope = (userId: string | undefined, spaceId: string, botId: string) =>
  JSON.stringify([userId, spaceId, botId]);

/**
 * The conversation list of one Mico for a sidebar row that is expanded: read once and again
 * whenever the roster reports that its conversations moved (`revision`). It shares the query
 * cache with the Mico's tabs, so both always show the same rows. Never read on hover.
 */
export function useSidebarConversationRows(input: {
  enabled: boolean;
  rpc: Pick<RpcClient, "development">;
  scope: string;
  botId: string;
  revision?: string;
}): { rows: ConversationRow[]; loaded: boolean } {
  const { enabled, rpc, scope, botId, revision } = input;
  const rows = useConversationRows(scope);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void rpc.development.list({ botId }).then(listed => {
      if (!live) return;
      writeConversationRows(scope, () => sidebarListedRows(listed) as ConversationRow[]);
      setLoaded(true);
    }, () => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [enabled, rpc, scope, botId, revision]);
  return { rows, loaded: loaded || rows.length > 0 };
}

/** Open conversations with an unread reply, among the rows already loaded. */
export const unreadOpenConversations = (rows: readonly ConversationRow[]) =>
  rows.filter(row => !isClosedConversation(row) && !row.deleteAfter && row.unread);

// --- Which Mico rows are expanded on this device.

const OPEN_KEY = "mycellios:sidebar-open-micos:v1";
const openListeners = new Set<() => void>();
let openRaw: string | null | undefined;
let openIds: readonly string[] = [];
let unsavedOpen: string | null = null;

function readOpenMicos(): readonly string[] {
  let raw = unsavedOpen;
  if (raw === null) {
    try { raw = localStorage.getItem(OPEN_KEY); } catch { return openIds; }
  }
  if (raw === openRaw) return openIds;
  openRaw = raw;
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    openIds = Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))].slice(-200) : [];
  } catch { openIds = []; }
  return openIds;
}

export function setMicoConversationsOpen(botId: string, open: boolean) {
  const current = readOpenMicos();
  if (current.includes(botId) === open) return;
  const next = open ? [...current, botId] : current.filter(id => id !== botId);
  const raw = JSON.stringify(next.slice(-200));
  try { localStorage.setItem(OPEN_KEY, raw); unsavedOpen = null; } catch { unsavedOpen = raw; }
  for (const listener of openListeners) listener();
}

export function useOpenMicoConversations(): readonly string[] {
  return useSyncExternalStore(listener => {
    openListeners.add(listener);
    const sync = (event: StorageEvent) => { if (event.key === null || event.key === OPEN_KEY) listener(); };
    window.addEventListener("storage", sync);
    return () => { openListeners.delete(listener); window.removeEventListener("storage", sync); };
  }, readOpenMicos, () => openIds);
}
