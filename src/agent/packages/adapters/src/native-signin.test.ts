import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claudeSignedIn, codexSignedIn, forgetNativeSignIn, nativeSignInState, resetNativeSignInCache, watchNativeSignIn,
} from "./native-signin.js";

const claude = { command: "/bin/claude" };

afterEach(() => resetNativeSignInCache());

describe("sign-in status parsing", () => {
  it("keeps only Claude Code's loggedIn boolean", () => {
    expect(claudeSignedIn(JSON.stringify({ loggedIn: true, email: "someone@example.test" }))).toBe(true);
    expect(claudeSignedIn(JSON.stringify({ loggedIn: false }))).toBe(false);
    expect(claudeSignedIn(JSON.stringify({ loggedIn: "yes" }))).toBeUndefined();
    expect(claudeSignedIn("Logged in")).toBeUndefined();
  });

  it("reads Codex's account/read result", () => {
    expect(codexSignedIn({ account: { type: "chatgpt" }, requiresOpenaiAuth: true })).toBe(true);
    expect(codexSignedIn({ account: null, requiresOpenaiAuth: true })).toBe(false);
    expect(codexSignedIn({})).toBeUndefined();
    expect(codexSignedIn(null)).toBeUndefined();
  });
});

describe("nativeSignInState", () => {
  it("reuses a fresh answer instead of starting the CLI again", async () => {
    let now = 1_000;
    const probe = vi.fn(async () => false);
    expect(await nativeSignInState("claude", claude, { probe, now: () => now })).toBe(false);
    now += 30_000;
    expect(await nativeSignInState("claude", claude, { probe, now: () => now })).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);
    now += 31_000;
    probe.mockResolvedValueOnce(true);
    expect(await nativeSignInState("claude", claude, { probe, now: () => now })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("answers unknown for a slow first probe and keeps its result for the next read", async () => {
    let finish!: (value: boolean) => void;
    const probe = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    expect(await nativeSignInState("codex", claude, { probe, waitMs: 5 })).toBeUndefined();
    finish(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(await nativeSignInState("codex", claude, { probe, waitMs: 5 })).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("asks again after a sign-in change, and every few seconds while one may finish", async () => {
    let now = 1_000;
    const probe = vi.fn(async () => false);
    const read = () => nativeSignInState("claude", claude, { probe, now: () => now });
    expect(await read()).toBe(false);
    forgetNativeSignIn("claude", claude);
    probe.mockResolvedValueOnce(true);
    expect(await read()).toBe(true);
    expect(probe).toHaveBeenCalledTimes(2);
    watchNativeSignIn("claude", claude, now + 60_000);
    expect(await read()).toBe(false);
    now += 2_500;
    await read();
    expect(probe).toHaveBeenCalledTimes(4);
    now += 1_000;
    await read();
    expect(probe).toHaveBeenCalledTimes(4);
    // After the watch ends, a fresh answer lasts a minute again.
    now = 62_000;
    await read();
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it("treats a failing probe as unknown, never as signed in", async () => {
    const probe = vi.fn(async () => { throw new Error("spawn failed"); });
    expect(await nativeSignInState("claude", claude, { probe })).toBeUndefined();
  });
});
