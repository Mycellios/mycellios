// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  beginIdentityLink,
  captureIdentityLinkReturn,
  IDENTITY_LINK_STORAGE_KEY,
  takeIdentityLinkReturn,
} from "./identity-link-return";

afterEach(() => {
  window.sessionStorage.clear();
  takeIdentityLinkReturn();
  window.history.replaceState(null, "", "/");
});

function returnTo(path: string) {
  window.history.replaceState(null, "", path);
  return captureIdentityLinkReturn();
}

it("accepts only this tab's own state and never keeps the authority's session in the address", () => {
  const state = beginIdentityLink("google");
  expect(state).toMatch(/^[a-f0-9]{32}$/);
  const result = returnTo(
    `/agent/app?settings=profile&identityLinkState=${state}#access_token=secret-access&refresh_token=secret-refresh&type=bearer`,
  );
  expect(result).toEqual({ provider: "google", result: "linked" });
  expect(window.location.pathname + window.location.search + window.location.hash).toBe("/agent/app?settings=profile");
  expect(window.location.href).not.toContain("secret");
  expect(window.sessionStorage.getItem(IDENTITY_LINK_STORAGE_KEY)).toBeNull();
  expect(takeIdentityLinkReturn()).toEqual({ provider: "google", result: "linked" });
  expect(takeIdentityLinkReturn()).toBeNull();
});

it("reports the authority's refusal code from the query or the fragment", () => {
  const state = beginIdentityLink("twitter");
  expect(returnTo(`/agent/app?settings=profile&identityLinkState=${state}&error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked`))
    .toEqual({ provider: "twitter", result: "failed", code: "identity_already_exists" });
  expect(window.location.search).toBe("?settings=profile");
  const next = beginIdentityLink("google");
  expect(returnTo(`/agent/app?settings=profile&identityLinkState=${next}#error=access_denied&error_description=Denied`))
    .toEqual({ provider: "google", result: "failed", code: "access_denied" });
});

it("ignores a forged, replayed or stale return but still cleans the address", () => {
  beginIdentityLink("google");
  expect(returnTo(`/agent/app?settings=profile&identityLinkState=${"f".repeat(32)}#access_token=forged`)).toBeNull();
  expect(window.location.href).not.toContain("forged");
  const state = beginIdentityLink("google");
  expect(returnTo(`/agent/app?settings=profile&identityLinkState=${state}`)).not.toBeNull();
  expect(returnTo(`/agent/app?settings=profile&identityLinkState=${state}`)).toBeNull();
  const old = beginIdentityLink("google");
  window.history.replaceState(null, "", `/agent/app?identityLinkState=${old}`);
  expect(captureIdentityLinkReturn(window.location, window.history, window.sessionStorage, Date.now() + 11 * 60_000)).toBeNull();
});

it("leaves ordinary addresses untouched", () => {
  window.history.replaceState(null, "", "/agent/app?settings=profile&error=other#section");
  expect(captureIdentityLinkReturn()).toBeNull();
  expect(window.location.search).toBe("?settings=profile&error=other");
  expect(window.location.hash).toBe("#section");
});
