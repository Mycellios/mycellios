import { afterEach, expect, it, vi } from "vitest";
import { hifaStoreEnabled } from "./hifa-store";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "true"])("opens the Store for the application launch (%s)", value => {
  vi.stubEnv("VITE_MYCELLIOS_HIFA_STORE", value);
  expect(hifaStoreEnabled()).toBe(true);
});
it("preserves the operator's explicit pause without removing apps", () => {
  vi.stubEnv("VITE_MYCELLIOS_HIFA_STORE", "false");
  expect(hifaStoreEnabled()).toBe(false);
});
