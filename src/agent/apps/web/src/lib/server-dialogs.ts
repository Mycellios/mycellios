import type { SavedServer } from "./server-connections";
type ServerDialogInput = { ownerId: string | null } & (
  | { kind: "add"; currentUrl: string }
  | { kind: "settings"; server: SavedServer; current: boolean; initial: "general" | "notifications"; canEdit: boolean;
      save(identity: { name: string; color: string }): Promise<void>; manage(): Promise<void> }
);
export type ServerDialog = ServerDialogInput & { id: number };
let active: ServerDialog | null = null, nextId = 0;
const listeners = new Set<() => void>();
export function openServerDialog(input: ServerDialogInput) { active = { ...input, id: ++nextId }; for (const listener of listeners) listener(); }
export function serverDialogSnapshot() { return active; }
export function subscribeServerDialog(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** A late save/close cannot dismiss a newer request or another account's form. */
export function closeServerDialog(id?: number) { if (id !== undefined && active?.id !== id) return; active = null; for (const listener of listeners) listener(); }
