// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GuestChatRequestError, guestApi, guestCache, guestChatEligible, guestHistory, isGuestEntry, leadingZeroBits,
  solveChallenge, withoutImages,
} from "./guest-chat";

const limits = { messagesPerSession: 12, messageChars: 4000, historyMessages: 8, historyBytes: 24_576 };
const host = (extra: Record<string, unknown> = {}, standalone = false) => ({
  matchMedia: (query: string) => ({ matches: standalone && query.includes("standalone") }) as MediaQueryList,
  location: window.location, navigator: { standalone: false } as Navigator & { standalone?: boolean }, ...extra,
});
const sse = (events: unknown[]) => new Response(events.map(e => "data: " + JSON.stringify(e) + "\n\n").join(""),
  { headers: { "content-type": "text/event-stream" } });

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete (window as { MycelliosNative?: unknown }).MycelliosNative; });

describe("guest chat eligibility", () => {
  it("is limited to an ordinary browser tab on the bare entry", () => {
    expect(guestChatEligible(host())).toBe(true);
    expect(guestChatEligible(host({ mycelliosDesktop: {} }))).toBe(false);
    expect(guestChatEligible(host({ rakazoDesktop: {} }))).toBe(false);
    expect(guestChatEligible(host({ ReactNativeWebView: { postMessage() {} } }))).toBe(false);
    expect(guestChatEligible(host({}, true))).toBe(false);
    expect(guestChatEligible(host({ navigator: { standalone: true } }))).toBe(false);
    (window as { MycelliosNative?: unknown }).MycelliosNative = { postMessage() {} };
    expect(guestChatEligible(host())).toBe(false);
    expect(isGuestEntry("")).toBe(true);
    for (const deep of ["?task=1", "?inbox=x", "?settings=api-keys", "?next=/app"]) expect(isGuestEntry(deep)).toBe(false);
  });
});

describe("guest chat helpers", () => {
  it("solves the proof of work the coordinator checks", async () => {
    expect(leadingZeroBits(new Uint8Array([0, 0x10]))).toBe(11);
    const solution = await solveChallenge("test-only.challenge", 8);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("test-only.challenge:" + solution)));
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(8);
    const aborted = new AbortController(); aborted.abort();
    await expect(solveChallenge("x", 20, aborted.signal)).rejects.toThrow();
  });
  it("sends only the bounded recent history, starting with the visitor", () => {
    const many = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: "m" + i }));
    const recent = guestHistory(many, limits);
    expect(recent.length).toBeLessThanOrEqual(8);
    expect(recent[0]!.role).toBe("user");
    expect(recent.at(-1)!.content).toBe("m10");
    const large = [{ role: "user" as const, content: "a".repeat(20_000) }, { role: "assistant" as const, content: "b".repeat(10_000) },
      { role: "user" as const, content: "c" }];
    expect(guestHistory(large, limits)).toEqual([{ role: "user", content: "c" }]);
  });
  it("drops markdown images so generated output cannot load remote pixels", () => {
    expect(withoutImages("See ![tracker](https://evil.invalid/p.png?x=secret) and [a link](https://ok.invalid)"))
      .toBe("See tracker and [a link](https://ok.invalid)");
    expect(withoutImages("![ref][1]\n\n[1]: https://evil.invalid/p.png")).not.toContain("evil.invalid");
  });
  it("keeps the transcript per tab and survives unavailable storage", () => {
    guestCache.save([{ role: "user", content: "hola" }], { key: "00000000-0000-4000-8000-000000000000", messages: [{ role: "user", content: "hola" }] });
    expect(guestCache.load().messages).toEqual([{ role: "user", content: "hola" }]);
    expect(localStorage.length).toBe(0);
    sessionStorage.setItem("mycellios:guest:chat", JSON.stringify({ messages: [{ role: "system", content: "x" }] }));
    expect(guestCache.load()).toEqual({ messages: [], pending: null });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(guestCache.load()).toEqual({ messages: [], pending: null });
    expect(() => guestCache.save([], null)).not.toThrow();
  });
});

describe("guest chat client", () => {
  it("streams text, returns the result and maps refusals to codes", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(sse([{ type: "delta", content: "Hola " }, { type: "delta", content: "mundo" },
        { type: "result", result: { status: "completed", content: "Hola mundo", remaining: 11 } }]))
      .mockResolvedValueOnce(Response.json({ error: { code: "guest_session_limit_reached" } }, { status: 429 }))
      .mockResolvedValueOnce(sse([{ type: "delta", content: "x" }, { type: "error", code: "guest_temporarily_unavailable" }]));
    vi.stubGlobal("fetch", fetch);
    const seen: string[] = [];
    const input = { key: "00000000-0000-4000-8000-000000000000", messages: [{ role: "user" as const, content: "hola" }] };
    await expect(guestApi.chat(input, text => seen.push(text), new AbortController().signal))
      .resolves.toEqual({ status: "completed", content: "Hola mundo", remaining: 11 });
    expect(seen).toEqual(["Hola ", "Hola mundo"]);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("/mobile/v1/guest/chat");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", redirect: "error", headers: { accept: "text/event-stream" } });
    await expect(guestApi.chat(input, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: "guest_session_limit_reached" });
    await expect(guestApi.chat(input, () => {}, new AbortController().signal)).rejects.toBeInstanceOf(GuestChatRequestError);
  });
  it("treats a missing or expired session as none and solves a challenge to enter", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { code: "guest_session_required" } }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ enabled: true, limits, challenge: { token: "test-only.challenge", difficulty: 4, expiresAt: Date.now() + 60_000 } }))
      .mockResolvedValueOnce(Response.json({ remaining: 12, limit: 12, expiresAt: Date.now() + 1000 }));
    vi.stubGlobal("fetch", fetch);
    await expect(guestApi.status()).resolves.toBeNull();
    await expect(guestApi.enter()).resolves.toMatchObject({ remaining: 12 });
    const body = JSON.parse(String(fetch.mock.calls[2]![1].body));
    expect(body.challenge).toBe("test-only.challenge");
    expect(body.solution).toMatch(/^\d+$/);
    expect(body.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // The same browser resumes with the same nonce.
    expect(localStorage.getItem("mycellios:guest:nonce")).toBe(body.nonce);
  });
});
