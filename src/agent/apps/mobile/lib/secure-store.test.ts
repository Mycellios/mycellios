import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));

const { deleteItemAsync, getItem, getItemAsync, legacySecureStoreKey, setItemAsync } = await import(
  "./secure-store"
);

const legacy = legacySecureStoreKey("mycellios.session_token") as string;

describe("secure store key rename", () => {
  beforeEach(() => store.clear());

  it("reads the legacy key when the current one is missing", async () => {
    store.set(legacy, "old-token");
    expect(await getItemAsync("mycellios.session_token")).toBe("old-token");
    expect(getItem("mycellios.session_token")).toBe("old-token");
  });

  it("prefers the current key, including an empty value", async () => {
    store.set(legacy, "old-token");
    await setItemAsync("mycellios.session_token", "");
    expect(await getItemAsync("mycellios.session_token")).toBe("");
  });

  it("deletes both names so a removed value does not return", async () => {
    store.set(legacy, "old-token");
    store.set("mycellios.session_token", "new-token");
    await deleteItemAsync("mycellios.session_token");
    expect(await getItemAsync("mycellios.session_token")).toBeNull();
  });

  it("leaves other keys alone", async () => {
    expect(legacySecureStoreKey("other.key")).toBeNull();
    expect(await getItemAsync("other.key")).toBeNull();
  });
});
