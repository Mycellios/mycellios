import { expect, it } from "vitest";
import { shouldRestoreSavedSpace } from "./startup-space";
it("starts in the default space when restoration is off on an app entry URL", () => {
  for (const path of ["/", "/app", "/app/", "/preview/app"]) expect(shouldRestoreSavedSpace(false, path)).toBe(false);
});
it("preserves an explicit chat, task or other workspace deep link", () => {
  for (const path of ["/app/mico-123", "/app/group/team-456", "/preview/app/mico-123", "/app/schedule"])
    expect(shouldRestoreSavedSpace(false, path)).toBe(true);
});
it("keeps saved space restoration when enabled", () => {
  expect(shouldRestoreSavedSpace(true, "/app")).toBe(true);
});
