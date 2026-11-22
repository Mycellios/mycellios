import { useSyncExternalStore } from "react";

/**
 * Conversations opened beside the main chat, in the side panel's Conversations pane: their
 * order and which one is shown (null shows the list). Kept per user, Space and Mico for this
 * browser tab; closing one never touches the conversation itself.
 */
export type BesideConversations = Readonly<{ ids: readonly string[]; active: string | null }>;

export const NO_BESIDE: BesideConversations = Object.freeze({ ids: [], active: null });
/** More would not fit as readable tabs in the side panel; the oldest one gives way. */
export const BESIDE_LIMIT = 6;

export function openBeside(state: BesideConversations, id: string): BesideConversations {
  const ids = state.ids.includes(id) ? [...state.ids] : [...state.ids, id];
  while (ids.length > BESIDE_LIMIT) ids.splice(ids.findIndex(item => item !== id), 1);
  return { ids, active: id };
}

/**
 * Closes one: when it was shown, its right-hand neighbour takes its place, else the one on its
 * left, else the list.
 */
export function closeBeside(state: BesideConversations, id: string): BesideConversations {
  const index = state.ids.indexOf(id);
  if (index < 0) return state;
  const ids = state.ids.filter(item => item !== id);
  if (state.active !== id) return { ids, active: state.active };
  return { ids, active: ids[index] ?? ids[index - 1] ?? null };
}

export function showBeside(state: BesideConversations, id: string | null): BesideConversations {
  if (id !== null && !state.ids.includes(id)) return state;
  return state.active === id ? state : { ...state, active: id };
}

/** Conversations that closed (archived, deleted or opened in the chat) leave the pane the same way. */
export function pruneBeside(state: BesideConversations, keep: (id: string) => boolean): BesideConversations {
  let next = state;
  for (const id of state.ids) if (!keep(id)) next = closeBeside(next, id);
  return next;
}

function parse(raw: string | null): BesideConversations {
  try {
    const value = JSON.parse(raw ?? "null") as { ids?: unknown; active?: unknown } | null;
    if (!value || !Array.isArray(value.ids)) return NO_BESIDE;
    const ids = [...new Set(value.ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))]
      .slice(-BESIDE_LIMIT);
    const active = typeof value.active === "string" && ids.includes(value.active) ? value.active : null;
    return { ids, active };
  } catch { return NO_BESIDE; }
}

const PREFIX = "mycellios:beside-conversations:";
const cache = new Map<string, { raw: string | null; state: BesideConversations }>();
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function readRaw(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function readBeside(scope: string): BesideConversations {
  const key = PREFIX + scope;
  const raw = readRaw(key);
  const cached = cache.get(key);
  if (cached && cached.raw === raw) return cached.state;
  const state = parse(raw);
  cache.set(key, { raw, state });
  return state;
}

export function updateBeside(scope: string, change: (state: BesideConversations) => BesideConversations): BesideConversations {
  const key = PREFIX + scope;
  const current = readBeside(scope);
  const next = change(current);
  if (next === current) return current;
  const raw = JSON.stringify({ ids: next.ids, active: next.active });
  try { sessionStorage.setItem(key, raw); memory.delete(key); } catch { memory.set(key, raw); }
  cache.set(key, { raw, state: next });
  for (const listener of listeners.get(key) ?? []) listener();
  return next;
}

export function useBeside(scope: string | undefined): BesideConversations {
  return useSyncExternalStore(
    listener => {
      if (!scope) return () => undefined;
      const key = PREFIX + scope;
      let set = listeners.get(key);
      if (!set) { set = new Set(); listeners.set(key, set); }
      set.add(listener);
      return () => { set.delete(listener); if (!set.size) listeners.delete(key); };
    },
    () => scope ? readBeside(scope) : NO_BESIDE,
    () => NO_BESIDE,
  );
}
