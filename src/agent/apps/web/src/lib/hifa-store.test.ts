import { afterEach, expect, it, vi } from "vitest";
import { hifaStoreEnabled } from "./hifa-store";

afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "false", "1", "TRUE"])("keeps the Store paused without explicit enablement (%s)", value => {
  vi.stubEnv("VITE_MYCELLIOS_HIFA_STORE", value);
  expect(hifaStoreEnabled()).toBe(false);
});
it("allows explicit reactivation without removing the apps", () => {
  vi.stubEnv("VITE_MYCELLIOS_HIFA_STORE", "true");
  expect(hifaStoreEnabled()).toBe(true);
});
