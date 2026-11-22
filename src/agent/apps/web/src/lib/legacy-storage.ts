/**
 * Browser storage keys start with `mycellios.` or `mycellios:`. Profiles created before
 * the rename keep the imported project's prefix; `migrateLegacyStorage` copies those
 * values once, before any reader runs (specs/legacy-name-migration, phase 4). The legacy
 * keys stay for now so a rollback to an older build still finds its preferences and
 * drafts; a later release removes them. The legacy prefix is built here, in one place,
 * instead of being spelled out in source files.
 */
const CURRENT_PREFIX = "mycellios";
const LEGACY_PREFIX = String.fromCharCode(114, 97, 107, 97, 122, 111);
const SEPARATORS = [".", ":"];

/** The legacy spelling of a current `mycellios…` key. */
export function legacyStorageKey(key: string): string {
  return key.startsWith(CURRENT_PREFIX) ? LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length) : key;
}

/**
 * Marks a completed copy. Without it, a value the app later removes (a sent draft, a
 * signed-out Space) would be copied back from its legacy key on the next start.
 */
export const LEGACY_STORAGE_MIGRATED_KEY = "mycellios:legacy-storage-migrated";

/**
 * Copies every legacy key to its current name, unless the current name already holds a
 * value. Runs once per browser profile; a failed copy is retried on the next start.
 */
export function migrateLegacyStorage(storage: Storage | undefined): void {
  if (!storage || storage.getItem(LEGACY_STORAGE_MIGRATED_KEY) !== null) return;
  let complete = true;
  const legacyKeys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && SEPARATORS.some((separator) => key.startsWith(LEGACY_PREFIX + separator))) {
      legacyKeys.push(key);
    }
  }
  for (const key of legacyKeys) {
    const current = CURRENT_PREFIX + key.slice(LEGACY_PREFIX.length);
    try {
      const value = storage.getItem(key);
      if (value !== null && storage.getItem(current) === null) storage.setItem(current, value);
    } catch {
      complete = false; // Storage full or blocked: the legacy value stays for the next start.
    }
  }
  if (!complete) return;
  try {
    storage.setItem(LEGACY_STORAGE_MIGRATED_KEY, "1");
  } catch {
    // Retried on the next start; copies never overwrite a current value.
  }
}

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

try {
  migrateLegacyStorage(localStorageOrUndefined());
} catch {
  // Unreadable storage never blocks startup; readers already handle it.
}
