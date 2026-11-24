// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthServiceError, InvitationRequired, signUp } from "./auth";

const config = { enabled: true, url: "https://authority.example.test", anonKey: "public-fixture" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("says sign-up needs an invitation when the closed beta refuses an account without one", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockResolvedValueOnce(Response.json({ msg: "Database error saving new user" }, { status: 500 }));
  await expect(signUp(config, "person@example.test", "a-strong-fixture-password")).rejects.toBeInstanceOf(InvitationRequired);
});

it("keeps ordinary sign-up errors when there is no invitation", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response("", { status: 404 }))
    .mockResolvedValueOnce(Response.json({ msg: "User already registered", error_code: "user_already_exists" }, { status: 422 }));
  const failure = await signUp(config, "person@example.test", "a-strong-fixture-password").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AuthServiceError);
  expect((failure as AuthServiceError).code).toBe("user_already_exists");
});
