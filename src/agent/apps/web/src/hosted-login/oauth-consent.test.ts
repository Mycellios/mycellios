// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { OAuthConsentError, restartExpiredAuthorization } from "./oauth-consent";

beforeEach(() => sessionStorage.clear());

it("treats only a missing, expired or used authorization as gone", () => {
  expect([400, 404, 410].map((s) => new OAuthConsentError(s).authorizationGone)).toEqual([true, true, true]);
  expect([401, 403, 429, 500, 502].map((s) => new OAuthConsentError(s).authorizationGone)).toEqual([
    false, false, false, false, false,
  ]);
});

it("restarts sign-in once and refuses again within two minutes", () => {
  const go = vi.fn();
  expect(restartExpiredAuthorization(go, 1_000_000)).toBe(true);
  expect(go).toHaveBeenCalledWith("/agent/sign-in");
  expect(restartExpiredAuthorization(go, 1_000_000 + 119_000)).toBe(false);
  expect(go).toHaveBeenCalledTimes(1);
  expect(restartExpiredAuthorization(go, 1_000_000 + 120_000)).toBe(true);
  expect(go).toHaveBeenCalledTimes(2);
});

it("keeps the explicit button when storage is unavailable", () => {
  const go = vi.fn();
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(restartExpiredAuthorization(go)).toBe(false);
  expect(go).not.toHaveBeenCalled();
  spy.mockRestore();
});
