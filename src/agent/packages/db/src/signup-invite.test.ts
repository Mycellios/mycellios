import { describe, expect, it } from "vitest";
import {
  SIGNUP_INVITE_COOKIE,
  signupInviteCodeFromCookie,
  signupInviteCodeMatches,
  signupInviteId,
} from "./signup-invite.js";

const invite = { code: "beta-invite-code-0123456789abcdef", limit: 10 };

describe("signup invitation", () => {
  it("stores a hash that changes with the code, never the code", () => {
    const id = signupInviteId(invite.code);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toContain(invite.code);
    expect(signupInviteId(`${invite.code}2`)).not.toBe(id);
  });

  it("accepts only the configured code", () => {
    expect(signupInviteCodeMatches(invite.code, invite)).toBe(true);
    expect(signupInviteCodeMatches(`${invite.code}x`, invite)).toBe(false);
    expect(signupInviteCodeMatches("", invite)).toBe(false);
    expect(signupInviteCodeMatches(undefined, invite)).toBe(false);
  });

  it("reads exactly one invitation cookie", () => {
    expect(signupInviteCodeFromCookie(`a=1; ${SIGNUP_INVITE_COOKIE}=abc; b=2`)).toBe("abc");
    expect(signupInviteCodeFromCookie("a=1")).toBeUndefined();
    expect(signupInviteCodeFromCookie(null)).toBeUndefined();
    expect(signupInviteCodeFromCookie(`${SIGNUP_INVITE_COOKIE}=`)).toBeUndefined();
    expect(
      signupInviteCodeFromCookie(`${SIGNUP_INVITE_COOKIE}=a; ${SIGNUP_INVITE_COOKIE}=b`),
    ).toBeUndefined();
    expect(signupInviteCodeFromCookie(`x${SIGNUP_INVITE_COOKIE}=abc`)).toBeUndefined();
  });
});
