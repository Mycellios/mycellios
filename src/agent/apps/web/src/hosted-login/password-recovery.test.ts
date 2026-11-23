// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { completePasswordReset, consumeRecoveryRedirect, requestPasswordReset, storedAuthSession } from "./auth";

const config = { enabled: true, url: "https://authority.example.test", anonKey: "public-fixture" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState({}, "", "/oauth/consent?authorization_id=fixture-authorization-12345");
});
afterEach(() => vi.unstubAllGlobals());

it("requests a reset link that returns to the same pending sign-in page", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  await requestPasswordReset(config, "person@example.test");
  const [url, init] = fetchMock.mock.calls[0]!;
  const target = new URL(String(url));
  expect(target.origin + target.pathname).toBe("https://authority.example.test/auth/v1/recover");
  expect(target.searchParams.get("redirect_to")).toBe(
    `${window.location.origin}/oauth/consent?authorization_id=fixture-authorization-12345`,
  );
  expect(init?.method).toBe("POST");
  expect(JSON.parse(String(init?.body))).toEqual({ email: "person@example.test" });
});

it("ignores ordinary pages and leaves their fragment alone", async () => {
  window.location.hash = "#section";
  await expect(consumeRecoveryRedirect(config)).resolves.toBeNull();
  expect(window.location.hash).toBe("#section");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("verifies a reset link, removes its tokens from the address and stores nothing yet", async () => {
  window.location.hash = "#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=600&type=recovery";
  fetchMock.mockResolvedValue(Response.json({ id: "user-1", email: "person@example.test" }));
  const recovery = await consumeRecoveryRedirect(config);
  expect(recovery).not.toBeNull();
  expect(recovery).not.toBe("expired");
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("?authorization_id=fixture-authorization-12345");
  expect(storedAuthSession()).toBeNull();
  if (!recovery || recovery === "expired") return;
  expect(recovery.session.user).toEqual({ id: "user-1", email: "person@example.test" });
  expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer recovery-access");
});

it("reports used or expired reset links", async () => {
  window.location.hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid";
  await expect(consumeRecoveryRedirect(config)).resolves.toBe("expired");
  expect(window.location.hash).toBe("");
  window.location.hash = "#access_token=recovery-access&refresh_token=recovery-refresh&type=recovery";
  fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
  await expect(consumeRecoveryRedirect(config)).resolves.toBe("expired");
});

it("stores the session only after the new password is saved", async () => {
  const session = { accessToken: "recovery-access", refreshToken: "recovery-refresh", expiresAt: Date.now() + 60_000, user: { id: "user-1", email: null } };
  fetchMock.mockResolvedValueOnce(Response.json({ code: 422, error_code: "weak_password" }, { status: 422 }));
  await expect(completePasswordReset(config, { session }, "short")).rejects.toMatchObject({ code: "weak_password" });
  expect(storedAuthSession()).toBeNull();
  fetchMock.mockResolvedValueOnce(Response.json({ id: "user-1" }));
  await expect(completePasswordReset(config, { session }, "a-new-strong-fixture-password")).resolves.toEqual(session);
  const [, init] = fetchMock.mock.calls[1]!;
  expect(init?.method).toBe("PUT");
  expect(JSON.parse(String(init?.body))).toEqual({ password: "a-new-strong-fixture-password" });
  expect(storedAuthSession()).toEqual(session);
});
