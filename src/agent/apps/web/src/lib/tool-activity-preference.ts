export type ToolActivityPreference = "on" | "off" | "expanded";

export const TOOL_ACTIVITY_STORAGE_KEY = "rakazo.showToolActivity";

export type ResolveToolActivityOptions = {
  stored?: string | null;
  storage?: Pick<Storage, "getItem"> | null;
};

const listeners = new Set<() => void>();
let memoryPreference: ToolActivityPreference | null = null;

function getLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function readStored(storage: Pick<Storage, "getItem"> | null | undefined): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(TOOL_ACTIVITY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

/** Legacy off means folded, not hidden: every turn's available steps stay inspectable. */
export function normalizeToolActivityPreference(
  raw: string | null | undefined,
): ToolActivityPreference {
  const value = raw?.trim().toLowerCase();
  return value === "expanded" ? "expanded" : "on";
}

export function toolActivityEnabled(preference: ToolActivityPreference = "on"): boolean {
  return normalizeToolActivityPreference(preference) !== "off";
}

export function resolveToolActivityPreference(
  options: ResolveToolActivityOptions = {},
): ToolActivityPreference {
  const stored =
    options.stored !== undefined
      ? options.stored
      : readStored(options.storage ?? getLocalStorage());
  return normalizeToolActivityPreference(stored);
}

export function persistToolActivityPreference(
  preference: ToolActivityPreference,
  storage: Pick<Storage, "setItem"> | null = getLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TOOL_ACTIVITY_STORAGE_KEY, preference);
    return true;
  } catch {
    // Ignore quota / private-mode failures; the in-memory preference still applies.
    return false;
  }
}

export function getToolActivityPreference(): ToolActivityPreference {
  return memoryPreference ?? resolveToolActivityPreference();
}

export function getToolActivityEnabled(): boolean {
  return toolActivityEnabled(getToolActivityPreference());
}

export function getToolActivityExpanded(): boolean {
  return getToolActivityPreference() === "expanded";
}

export function setToolActivityPreference(
  preference: ToolActivityPreference,
): ToolActivityPreference {
  const normalized = normalizeToolActivityPreference(preference);
  memoryPreference = persistToolActivityPreference(normalized) ? null : normalized;
  notify();
  return normalized;
}

let storageWindow: Window | null = null;
function storageChanged(event: StorageEvent) {
  if (event.key !== null && event.key !== TOOL_ACTIVITY_STORAGE_KEY) return;
  if (event.storageArea && event.storageArea !== getLocalStorage()) return;
  notify();
}

export function subscribeToolActivity(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageWindow && typeof window !== "undefined") {
    storageWindow = window;
    storageWindow.addEventListener("storage", storageChanged);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && storageWindow) {
      storageWindow.removeEventListener("storage", storageChanged);
      storageWindow = null;
    }
  };
}
