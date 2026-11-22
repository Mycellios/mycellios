import type { SideThread } from "@mycellios/contracts";
import { hashKey } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { queryClient } from "./query";

/**
 * The open conversation tabs of one Mico on this device: their order, the active tab,
 * tabs closed because the conversation was archived or deleted somewhere else (so a
 * restore brings them back at their place), and the newest Mico-started conversation
 * already seen. Stored per user, Space and Mico. Closing a tab never touches the
 * conversation; the stored ids are capped, the number of conversations is not.
 */
export const NEW_CONVERSATION_TAB = "new-conversation";
export const STORED_TAB_LIMIT = 50;

/** One development.list row. Older servers omit everything after the title. */
export type ConversationRow = { threadId: string; title: string } & Partial<Omit<SideThread, "threadId" | "title">>;

export type ParkedTab = Readonly<{ id: string; index: number }>;
export type ConversationTabs = Readonly<{
  ids: readonly string[];
  /** The last active tab: a thread id, NEW_CONVERSATION_TAB, or null for the main chat. */
  active: string | null;
  parked: readonly ParkedTab[];
  /** Mico-started conversations created up to this time have been shown or dismissed. */
  agentSince: string | null;
}>;

export const EMPTY_CONVERSATION_TABS: ConversationTabs = Object.freeze({ ids: [], active: null, parked: [], agentSince: null });
const EPOCH = new Date(0).toISOString();

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))];
}

function parkedTabs(value: unknown): ParkedTab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const { id, index } = item as { id?: unknown; index?: unknown };
    if (typeof id !== "string" || !id || seen.has(id) || typeof index !== "number" || !Number.isInteger(index) || index < 0) return [];
    seen.add(id);
    return [{ id, index }];
  });
}

/** Reads the stored form, including the plain id list older versions wrote. */
export function parseConversationTabs(raw: string | null): ConversationTabs {
  if (!raw) return EMPTY_CONVERSATION_TABS;
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return capConversationTabs({ ...EMPTY_CONVERSATION_TABS, ids: uniqueStrings(value) });
    if (value && typeof value === "object") {
      const stored = value as Record<string, unknown>;
      return capConversationTabs({
        ids: uniqueStrings(stored.ids),
        active: typeof stored.active === "string" ? stored.active : null,
        parked: parkedTabs(stored.parked),
        agentSince: typeof stored.agentSince === "string" ? stored.agentSince : null,
      });
    }
  } catch { /* A damaged entry starts over. */ }
  return EMPTY_CONVERSATION_TABS;
}

/** Keeps at most STORED_TAB_LIMIT ids, dropping the oldest tabs but never the active one. */
export function capConversationTabs(state: ConversationTabs): ConversationTabs {
  let ids = state.ids;
  if (ids.length > STORED_TAB_LIMIT) {
    const keep = new Set(ids.slice(-STORED_TAB_LIMIT));
    if (state.active && ids.includes(state.active) && !keep.has(state.active)) {
      keep.delete(ids.find(id => keep.has(id) && id !== state.active)!);
      keep.add(state.active);
    }
    ids = ids.filter(id => keep.has(id));
  }
  const parked = state.parked.length > STORED_TAB_LIMIT ? state.parked.slice(-STORED_TAB_LIMIT) : state.parked;
  return ids === state.ids && parked === state.parked ? state : { ...state, ids, parked };
}

export function openTab(state: ConversationTabs, id: string, index?: number): ConversationTabs {
  if (state.ids.includes(id)) return state;
  const ids = [...state.ids];
  ids.splice(index === undefined ? ids.length : Math.max(0, Math.min(index, ids.length)), 0, id);
  return { ...state, ids, parked: state.parked.filter(tab => tab.id !== id) };
}

export function closeTab(state: ConversationTabs, id: string): ConversationTabs {
  return state.ids.includes(id) ? { ...state, ids: state.ids.filter(tab => tab !== id) } : state;
}

/** Keeps only `id` open; from the main chat (null) it closes every conversation tab. */
export function closeOtherTabs(state: ConversationTabs, id: string | null): ConversationTabs {
  const ids = id && state.ids.includes(id) ? [id] : [];
  return ids.length === state.ids.length ? state : { ...state, ids };
}

/** Closes the tabs after `id`; the main chat (null) sits before every tab. */
export function closeTabsToRight(state: ConversationTabs, id: string | null): ConversationTabs {
  const index = id === null ? -1 : state.ids.indexOf(id);
  if (id !== null && index < 0) return state;
  const ids = state.ids.slice(0, index + 1);
  return ids.length === state.ids.length ? state : { ...state, ids };
}

export function placeTab(state: ConversationTabs, id: string, index: number): ConversationTabs {
  const from = state.ids.indexOf(id);
  if (from < 0) return state;
  const ids = state.ids.filter(tab => tab !== id);
  const to = Math.max(0, Math.min(index, ids.length));
  if (to === from) return state;
  ids.splice(to, 0, id);
  return { ...state, ids };
}

export function moveTab(state: ConversationTabs, id: string, delta: number): ConversationTabs {
  const from = state.ids.indexOf(id);
  return from < 0 ? state : placeTab(state, id, from + delta);
}

/** Hides a tab whose conversation closed, remembering its place for a restore. */
export function parkTab(state: ConversationTabs, id: string): ConversationTabs {
  const index = state.ids.indexOf(id);
  if (index < 0) return state;
  return { ...state, ids: state.ids.filter(tab => tab !== id), parked: [...state.parked.filter(tab => tab.id !== id), { id, index }] };
}

/** Puts a parked tab back at its old place. */
export function unparkTab(state: ConversationTabs, id: string): ConversationTabs {
  const parked = state.parked.find(tab => tab.id === id);
  if (!parked) return state;
  return openTab({ ...state, parked: state.parked.filter(tab => tab.id !== id) }, id, parked.index);
}

/** The draft tab becomes the conversation its first message created, in the same place. */
export function adoptNewConversation(state: ConversationTabs, threadId: string): ConversationTabs {
  if (!state.ids.includes(NEW_CONVERSATION_TAB)) return { ...openTab(state, threadId), active: threadId };
  const ids = state.ids.filter(id => id !== threadId).map(id => id === NEW_CONVERSATION_TAB ? threadId : id);
  return { ...state, ids, active: threadId, parked: state.parked.filter(tab => tab.id !== threadId) };
}

export const isClosedConversation = (row: ConversationRow) => Boolean(row.archived || row.archivedAt || row.deleteAfter);

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Applies what the server reports to the open tabs:
 * - a tab whose conversation was archived or is being deleted closes and is parked; the
 *   active tab only when it changed while it was open, so viewing an archived
 *   conversation on purpose keeps its tab;
 * - a parked tab comes back at its place once the conversation is open again, and is
 *   forgotten once it is gone;
 * - a conversation the Mico started since the last list joins the end of the tabs,
 *   without becoming active. The first list only records the newest time.
 */
export function reconcileConversationTabs(
  state: ConversationTabs,
  rows: readonly ConversationRow[],
  options: { activeId?: string; previous?: readonly ConversationRow[]; complete?: boolean } = {},
): ConversationTabs {
  const byId = new Map(rows.map(row => [row.threadId, row]));
  const before = new Map((options.previous ?? []).map(row => [row.threadId, row]));
  let next = state;
  for (const id of state.ids) {
    if (id === NEW_CONVERSATION_TAB) continue;
    const row = byId.get(id);
    if (!row) {
      // A purged conversation leaves; a just-created one may not be listed yet.
      if (options.complete && id !== options.activeId) next = closeTab(next, id);
      continue;
    }
    if (!isClosedConversation(row)) continue;
    const seen = before.get(id);
    if (id === options.activeId && (!seen || isClosedConversation(seen))) continue;
    next = parkTab(next, id);
  }
  for (const parked of state.parked) {
    const row = byId.get(parked.id);
    if (!row) {
      if (options.complete) next = { ...next, parked: next.parked.filter(tab => tab.id !== parked.id) };
    } else if (!isClosedConversation(row)) next = unparkTab(next, parked.id);
  }
  const newest = rows.reduce((latest, row) => Math.max(latest, time(row.createdAt)), 0);
  if (next.agentSince === null) {
    return { ...next, agentSince: newest ? new Date(newest).toISOString() : EPOCH };
  }
  const since = time(next.agentSince);
  const started = rows
    .filter(row => row.startedBy === "agent" && time(row.createdAt) > since)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt));
  if (!started.length) return next;
  for (const row of started) {
    if (!isClosedConversation(row) && !next.ids.includes(row.threadId) && !next.parked.some(tab => tab.id === row.threadId))
      next = openTab(next, row.threadId);
  }
  return { ...next, agentSince: new Date(Math.max(since, ...started.map(row => time(row.createdAt)))).toISOString() };
}

export type ConversationStatus = "working" | "queued" | "waiting" | "failed" | "unread";

/** The one mark a conversation shows: what it does now first, then how it ended, then unread. */
export function conversationStatus(row: ConversationRow): ConversationStatus | null {
  if (row.state === "running") return "working";
  if (row.state === "waiting") return "waiting";
  if (row.state === "queued") return "queued";
  if (row.state === "closed" || isClosedConversation(row)) return null;
  if (row.outcome === "failed") return "failed";
  return row.unread ? "unread" : null;
}

/** Open conversations, most recently updated first, then archived ones, newest first. */
export function pickerConversations(rows: readonly ConversationRow[]) {
  const visible = rows.filter(row => !row.deleteAfter);
  const recent = (row: ConversationRow) => time(row.updatedAt ?? row.createdAt);
  const order = (list: ConversationRow[]) => list
    .map((row, index) => ({ row, index }))
    .sort((a, b) => recent(b.row) - recent(a.row) || a.index - b.index)
    .map(({ row }) => row);
  return {
    open: order(visible.filter(row => !isClosedConversation(row))),
    archived: order(visible.filter(row => isClosedConversation(row))),
  };
}

// --- Persistence, shared by every tab strip of the same Mico and kept in step across windows.

const PREFIX = "mycellios:open-task-tabs:";
const failedWrites = new Map<string, string>();
const parsed = new Map<string, { raw: string | null; state: ConversationTabs }>();
const listeners = new Map<string, Set<() => void>>();
let watchingStorage = false;

export const conversationTabsStorageKey = (scope: string) => `${PREFIX}${scope}`;

function readRaw(key: string): string | null {
  if (failedWrites.has(key)) return failedWrites.get(key) ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function readConversationTabs(scope: string): ConversationTabs {
  const key = conversationTabsStorageKey(scope);
  const raw = readRaw(key);
  const cached = parsed.get(key);
  if (cached && cached.raw === raw) return cached.state;
  const state = parseConversationTabs(raw);
  parsed.set(key, { raw, state });
  return state;
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function updateConversationTabs(scope: string, update: (state: ConversationTabs) => ConversationTabs): ConversationTabs {
  const key = conversationTabsStorageKey(scope);
  const current = readConversationTabs(scope);
  const next = capConversationTabs(update(current));
  if (next === current) return current;
  const raw = JSON.stringify({ v: 2, ids: next.ids, active: next.active, parked: next.parked, agentSince: next.agentSince });
  try { localStorage.setItem(key, raw); failedWrites.delete(key); } catch { failedWrites.set(key, raw); }
  parsed.set(key, { raw, state: next });
  notify(key);
  return next;
}

function subscribe(scope: string, listener: () => void) {
  const key = conversationTabsStorageKey(scope);
  if (!watchingStorage && typeof window !== "undefined") {
    watchingStorage = true;
    window.addEventListener("storage", event => {
      if (event.key === null) for (const known of listeners.keys()) notify(known);
      else if (event.key.startsWith(PREFIX)) notify(event.key);
    });
  }
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  set.add(listener);
  return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
}

export function useConversationTabs(scope: string): ConversationTabs {
  return useSyncExternalStore(
    listener => subscribe(scope, listener),
    () => readConversationTabs(scope),
    () => EMPTY_CONVERSATION_TABS,
  );
}

// --- The last development.list answer, kept in the query cache across scoped remounts.

const NO_ROWS: ConversationRow[] = [];
export const conversationRowsKey = (scope: string) => ["conversation-tabs", scope] as const;

export function readConversationRows(scope: string): ConversationRow[] {
  return queryClient.getQueryData<ConversationRow[]>(conversationRowsKey(scope)) ?? NO_ROWS;
}

export function writeConversationRows(scope: string, update: (rows: ConversationRow[]) => ConversationRow[]) {
  const next = update(readConversationRows(scope));
  queryClient.setQueryData(conversationRowsKey(scope), next);
  return next;
}

export function useConversationRows(scope: string | undefined): ConversationRow[] {
  const hash = scope === undefined ? "" : hashKey(conversationRowsKey(scope));
  return useSyncExternalStore(
    listener => scope === undefined ? () => undefined : queryClient.getQueryCache().subscribe(event => {
      if (event.query.queryHash === hash) listener();
    }),
    () => scope === undefined ? NO_ROWS : readConversationRows(scope),
    () => NO_ROWS,
  );
}

// --- The request key of the draft tab's first send, so a retry never makes a second conversation.

const requestStorageKey = (scope: string) => `mycellios:new-conversation-request:${scope}`;
const memoryRequests = new Map<string, string>();

export function newConversationRequest(scope: string, botId: string): string {
  const key = requestStorageKey(scope);
  const prefix = `mico-task:${botId}:`;
  let stored: string | null = memoryRequests.get(key) ?? null;
  try { stored = localStorage.getItem(key) ?? stored; } catch { /* Memory keeps it. */ }
  if (stored?.startsWith(prefix) && stored.length <= 240) return stored;
  const request = `${prefix}${crypto.randomUUID()}`;
  memoryRequests.set(key, request);
  try { localStorage.setItem(key, request); } catch { /* Memory keeps it. */ }
  return request;
}

export function forgetNewConversationRequest(scope: string) {
  const key = requestStorageKey(scope);
  memoryRequests.delete(key);
  try { localStorage.removeItem(key); } catch { /* Nothing stored. */ }
}
