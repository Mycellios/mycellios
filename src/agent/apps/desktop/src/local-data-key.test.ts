import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_DATA_KEY_FILE,
  loadLocalDataKey,
  localIdentityIsProtected,
  type OsSecretStore,
  osSecretStoreUsable,
} from "./local-data-key.js";

const directories: string[] = [];
async function profile() {
  const directory = await mkdtemp(path.join(tmpdir(), "mycellios-data-key-"));
  directories.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

/** Reversible stand-in for the OS store; real wrapping is qualified on each platform. */
function store(options: { available?: boolean; backend?: string } = {}): OsSecretStore {
  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? "gnome_libsecret",
    encryptString: (value) => Buffer.from(`wrapped:${value}`).reverse(),
    decryptString: (value) => {
      const text = Buffer.from(value).reverse().toString();
      if (!text.startsWith("wrapped:")) throw new Error("not wrapped");
      return text.slice("wrapped:".length);
    },
  };
}

const read = async (directory: string) =>
  JSON.parse(await readFile(path.join(directory, LOCAL_DATA_KEY_FILE), "utf8"));

describe("local data key", () => {
  it("wraps a new key with the OS store and returns the same key later", async () => {
    const userDataDir = await profile();
    const options = { userDataDir, platform: "win32" as const, store: store(), protectedDataExists: false };
    const key = await loadLocalDataKey(options);
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    const saved = await read(userDataDir);
    expect(saved.protection).toBe("os");
    expect(saved.value).not.toContain(key);
    expect(await loadLocalDataKey({ ...options, protectedDataExists: true })).toBe(key);
  });

  it("falls back to an owner-only file without a usable store and upgrades later", async () => {
    const userDataDir = await profile();
    const key = await loadLocalDataKey({
      userDataDir, platform: "linux", store: store({ backend: "basic_text" }), protectedDataExists: false,
    });
    expect((await read(userDataDir)).protection).toBe("file");
    expect(await loadLocalDataKey({
      userDataDir, platform: "linux", store: store(), protectedDataExists: true,
    })).toBe(key);
    expect((await read(userDataDir)).protection).toBe("os");
  });

  it("never creates a new key while protected data exists", async () => {
    const userDataDir = await profile();
    await expect(loadLocalDataKey({
      userDataDir, platform: "darwin", store: store(), protectedDataExists: true,
    })).rejects.toThrow("missing");
  });

  it("never overwrites an existing record it cannot read", async () => {
    const userDataDir = await profile();
    await writeFile(path.join(userDataDir, LOCAL_DATA_KEY_FILE), "damaged");
    await expect(loadLocalDataKey({
      userDataDir, platform: "win32", store: store(), protectedDataExists: false,
    })).rejects.toThrow("could not be read");
    expect(await readFile(path.join(userDataDir, LOCAL_DATA_KEY_FILE), "utf8")).toBe("damaged");
  });

  it("fails when the OS store cannot open the wrapped key", async () => {
    const userDataDir = await profile();
    await loadLocalDataKey({ userDataDir, platform: "darwin", store: store(), protectedDataExists: false });
    const denied: OsSecretStore = { ...store(), decryptString: () => { throw new Error("denied"); } };
    await expect(loadLocalDataKey({
      userDataDir, platform: "darwin", store: denied, protectedDataExists: true,
    })).rejects.toThrow("denied");
  });

  it("treats Linux text backends as no store", () => {
    expect(osSecretStoreUsable("linux", store({ backend: "basic_text" }))).toBe(false);
    expect(osSecretStoreUsable("linux", store({ backend: "kwallet5" }))).toBe(true);
    expect(osSecretStoreUsable("win32", store({ available: false }))).toBe(false);
  });

  it("recognizes protected identity files", async () => {
    const userDataDir = await profile();
    const localData = path.join(userDataDir, "local-data");
    await mkdir(localData);
    expect(await localIdentityIsProtected(localData)).toBe(false);
    await writeFile(path.join(localData, "identity.json"), '{"encryptionKey":"x"}');
    expect(await localIdentityIsProtected(localData)).toBe(false);
    await writeFile(path.join(localData, "identity.json"), "mycellios-protected-identity:v1:abc");
    expect(await localIdentityIsProtected(localData)).toBe(true);
  });
});
