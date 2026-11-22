import { describe, expect, it } from "vitest";
import {
  LEGACY_STORAGE_MIGRATED_KEY,
  legacyStorageKey,
  migrateLegacyStorage,
} from "./legacy-storage";

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, String(value)),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
  };
}

const snapshot = (storage: Storage) =>
  Object.fromEntries(
    Array.from({ length: storage.length }, (_, index) => storage.key(index) as string).map((key) => [
      key,
      storage.getItem(key),
    ]),
  );

describe("legacy storage migration", () => {
  it("copies dotted and colon keys to the current prefix and keeps the legacy ones", () => {
    const legacy = {
      [legacyStorageKey("mycellios.uiLocale")]: "es",
      [legacyStorageKey("mycellios:space-id")]: "space-1",
      [legacyStorageKey("mycellios.composerDraft.bot:1")]: "draft",
    };
    const storage = memoryStorage({ ...legacy, other: "kept" });
    migrateLegacyStorage(storage);
    expect(snapshot(storage)).toEqual({
      ...legacy,
      other: "kept",
      "mycellios.uiLocale": "es",
      "mycellios:space-id": "space-1",
      "mycellios.composerDraft.bot:1": "draft",
      [LEGACY_STORAGE_MIGRATED_KEY]: "1",
    });
  });

  it("copies once, so a value removed later is not restored", () => {
    const storage = memoryStorage({ [legacyStorageKey("mycellios.composerDraft.bot:1")]: "sent" });
    migrateLegacyStorage(storage);
    storage.removeItem("mycellios.composerDraft.bot:1");
    migrateLegacyStorage(storage);
    expect(storage.getItem("mycellios.composerDraft.bot:1")).toBeNull();
  });

  it("keeps a value already saved under the current key", () => {
    const storage = memoryStorage({
      "mycellios.uiLocale": "en",
      [legacyStorageKey("mycellios.uiLocale")]: "es",
    });
    migrateLegacyStorage(storage);
    expect(storage.getItem("mycellios.uiLocale")).toBe("en");
  });

  it("tolerates storage that refuses writes", () => {
    const storage = memoryStorage({ [legacyStorageKey("mycellios.uiLocale")]: "es" });
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(() => migrateLegacyStorage(storage)).not.toThrow();
    expect(storage.getItem(legacyStorageKey("mycellios.uiLocale"))).toBe("es");
  });
});
