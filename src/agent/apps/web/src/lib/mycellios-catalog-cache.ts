import { type ModelCatalogEntry, ModelCatalogEntrySchema } from "@mycellios/contracts";

/**
 * The last Mycellios chat catalog this device read for an account, Space and connection.
 * The model picker shows it at once while the live catalog loads, so its long AntSeed list
 * does not keep the menu empty. It is display data only: choosing a model still goes through
 * the live catalog and the server's admission, and a fresh read always replaces it.
 */
const PREFIX = "mycellios.model-catalog.v1:";
/** Older copies are dropped rather than shown as current. */
const MAX_AGE_MS = 24 * 60 * 60_000;

function storageKey(scope: readonly (string | undefined)[]): string | null {
  return scope.every(Boolean) ? PREFIX + scope.join(":") : null;
}

export function readCachedMycelliosCatalog(
  scope: readonly (string | undefined)[],
  now = Date.now(),
): ModelCatalogEntry[] | undefined {
  const key = storageKey(scope);
  if (!key) return undefined;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { at?: unknown; data?: unknown } | null;
    if (!saved || typeof saved.at !== "number" || now - saved.at > MAX_AGE_MS || !Array.isArray(saved.data)) return undefined;
    const parsed = ModelCatalogEntrySchema.array().safeParse(saved.data);
    return parsed.success && parsed.data.length ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedMycelliosCatalog(
  scope: readonly (string | undefined)[],
  data: readonly ModelCatalogEntry[],
  now = Date.now(),
): void {
  const key = storageKey(scope);
  if (!key) return;
  try {
    if (data.length) localStorage.setItem(key, JSON.stringify({ at: now, data }));
    else localStorage.removeItem(key);
  } catch {
    // Blocked or full storage only loses the instant first paint.
  }
}
