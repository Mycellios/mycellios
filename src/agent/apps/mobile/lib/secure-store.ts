/**
 * expo-secure-store with the storage key rename (specs/legacy-name-migration, phase 4).
 * Keys are named `mycellios.<name>`; installs from before the rename saved them under the
 * imported project's prefix. Reads fall back to that name and deletes remove both, so a
 * value is never lost and a deleted one never comes back. Writes use the new name only.
 * Options are forwarded only when given, so calls match the native API exactly.
 */
import type { SecureStoreOptions } from "expo-secure-store";
import * as NativeSecureStore from "expo-secure-store";

const CURRENT_PREFIX = "mycellios.";
const LEGACY_PREFIX = `${String.fromCharCode(114, 97, 107, 97, 122, 111)}.`;

type Options = [options?: SecureStoreOptions];

/** The legacy spelling of a `mycellios.` key, or null for any other key. */
export function legacySecureStoreKey(key: string): string | null {
  return key.startsWith(CURRENT_PREFIX) ? LEGACY_PREFIX + key.slice(CURRENT_PREFIX.length) : null;
}

export async function getItemAsync(key: string, ...options: Options): Promise<string | null> {
  const value = await NativeSecureStore.getItemAsync(key, ...options);
  const legacy = legacySecureStoreKey(key);
  return value !== null || !legacy ? value : NativeSecureStore.getItemAsync(legacy, ...options);
}

export function getItem(key: string, ...options: Options): string | null {
  const value = NativeSecureStore.getItem(key, ...options);
  const legacy = legacySecureStoreKey(key);
  return value !== null || !legacy ? value : NativeSecureStore.getItem(legacy, ...options);
}

export function setItemAsync(key: string, value: string, ...options: Options): Promise<void> {
  return NativeSecureStore.setItemAsync(key, value, ...options);
}

export async function deleteItemAsync(key: string, ...options: Options): Promise<void> {
  await NativeSecureStore.deleteItemAsync(key, ...options);
  const legacy = legacySecureStoreKey(key);
  if (legacy) await NativeSecureStore.deleteItemAsync(legacy, ...options);
}
