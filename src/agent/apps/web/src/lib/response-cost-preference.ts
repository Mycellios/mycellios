const KEY = "mycellios.showResponseCost";
const listeners = new Set<() => void>();
let memory: boolean | null = null;
export function getResponseCostVisible(): boolean {
  if (memory !== null) return memory;
  try { return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "on"; } catch { return false; }
}
export function setResponseCostVisible(value: boolean): void {
  memory = value;
  try { localStorage.setItem(KEY, value ? "on" : "off"); } catch { /* In-memory choice still applies. */ }
  for (const listener of listeners) listener();
}
export function subscribeResponseCost(listener: () => void): () => void {
  listeners.add(listener);
  const changed = (event: StorageEvent) => { if (event.key === KEY || event.key === null) { memory = null; listener(); } };
  if (typeof window !== "undefined") window.addEventListener("storage", changed);
  return () => { listeners.delete(listener); if (typeof window !== "undefined") window.removeEventListener("storage", changed); };
}
