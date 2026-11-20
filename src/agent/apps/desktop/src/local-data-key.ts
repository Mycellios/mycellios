import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { readPrivateFile, writePrivateFile } from "./setup-store.js";

/**
 * The 32-byte key that protects the managed local server's identity (its database
 * password and the master key for content encryption).
 *
 * The key is wrapped by the operating system's secret store through Electron's
 * safeStorage: DPAPI on Windows, Keychain on macOS and libsecret/kwallet on Linux.
 * When no usable store exists (for example a Linux session without a keyring) the
 * key is kept in an owner-only file instead, which preserves today's behaviour, and
 * it moves into the store once one becomes available.
 */
export const LOCAL_DATA_KEY_FILE = "local-data-key.json";

export interface OsSecretStore {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

type StoredKey =
  | { version: 1; protection: "os"; value: string }
  | { version: 1; protection: "file"; value: string };

const KEY_PATTERN = /^[a-f0-9]{64}$/;
/** Linux backends that store secrets without real protection count as no store. */
const UNPROTECTED_LINUX_BACKENDS = new Set(["basic_text", "unknown"]);

export function osSecretStoreUsable(platform: NodeJS.Platform, store: OsSecretStore): boolean {
  if (!store.isEncryptionAvailable()) return false;
  if (platform !== "linux") return true;
  return !UNPROTECTED_LINUX_BACKENDS.has(store.getSelectedStorageBackend?.() ?? "unknown");
}

function parseStoredKey(raw: string): StoredKey | null {
  try {
    const value = JSON.parse(raw) as Partial<StoredKey>;
    if (value.version !== 1 || typeof value.value !== "string") return null;
    if (value.protection === "os" || value.protection === "file") return value as StoredKey;
  } catch {
    /* An unreadable record is handled by the caller. */
  }
  return null;
}

function wrapKey(key: string, platform: NodeJS.Platform, store: OsSecretStore): StoredKey {
  if (!osSecretStoreUsable(platform, store)) return { version: 1, protection: "file", value: key };
  const value = store.encryptString(key).toString("base64");
  // Never persist a wrapped key that this store cannot open again.
  if (store.decryptString(Buffer.from(value, "base64")) !== key)
    throw new Error("The secret store returned a different local data key.");
  return { version: 1, protection: "os", value };
}

/**
 * Returns the local data key, creating it on first use. It never replaces a key while
 * protected local data exists: a missing or unreadable key then fails, so the server
 * reports the problem instead of starting without access to the saved data.
 */
export async function loadLocalDataKey(options: {
  userDataDir: string;
  platform: NodeJS.Platform;
  store: OsSecretStore;
  protectedDataExists: boolean;
}): Promise<string> {
  const file = path.join(options.userDataDir, LOCAL_DATA_KEY_FILE);
  const raw = await readPrivateFile(file, 4096);
  const saved = raw === null ? null : parseStoredKey(raw);
  if (saved) {
    const key =
      saved.protection === "os"
        ? options.store.decryptString(Buffer.from(saved.value, "base64"))
        : saved.value;
    if (!KEY_PATTERN.test(key)) throw new Error("The local data key is invalid.");
    if (saved.protection === "file" && osSecretStoreUsable(options.platform, options.store)) {
      // Move a fallback key into the secret store once one is available. A failed move
      // keeps the existing file, which still opens the data.
      await Promise.resolve()
        .then(() => writePrivateFile(file, JSON.stringify(wrapKey(key, options.platform, options.store))))
        .catch(() => undefined);
    }
    return key;
  }
  // An existing record that cannot be read now (locked, damaged) is never overwritten.
  if (raw !== null || (await pathExists(file)))
    throw new Error("The local data key could not be read.");
  if (options.protectedDataExists) throw new Error("The local data key is missing.");
  const key = randomBytes(32).toString("hex");
  await writePrivateFile(file, JSON.stringify(wrapKey(key, options.platform, options.store)));
  return key;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

/** Protected identity files are not JSON; plaintext ones start with "{". */
export async function localIdentityIsProtected(localDataDir: string): Promise<boolean> {
  const contents = await readPrivateFile(path.join(localDataDir, "identity.json"), 64 * 1024);
  return contents !== null && contents.length > 0 && !contents.startsWith("{");
}
