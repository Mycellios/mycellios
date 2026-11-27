import { afterEach, expect, it, vi } from "vitest";
import { createCountStore } from "./MemoryRecall";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: unknown }) => children,
}));

afterEach(() => vi.useRealTimers());

it("reads every requested reply in one batch and remembers replies without a count", async () => {
  vi.useFakeTimers();
  const read = vi.fn(
    async (ids: string[]): Promise<Record<string, number>> => (ids.includes("a") ? { a: 3 } : {}),
  );
  const store = createCountStore(read);
  const seen = vi.fn();
  store.subscribe(seen);
  store.request("a");
  store.request("b");
  store.request("a");
  expect(store.get("a")).toBeUndefined();
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith(["a", "b"]);
  expect(store.get("a")).toBe(3);
  expect(store.get("b")).toBeNull();
  expect(seen).toHaveBeenCalled();
  store.request("b");
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(1);
});

it("shows nothing when the read fails", async () => {
  vi.useFakeTimers();
  const store = createCountStore(async () => {
    throw new Error("offline");
  });
  store.request("a");
  await vi.runAllTimersAsync();
  expect(store.get("a")).toBeNull();
});
