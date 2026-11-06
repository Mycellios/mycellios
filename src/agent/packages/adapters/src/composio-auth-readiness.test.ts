import { describe, expect, it, vi } from "vitest";
import { createComposioAuthReadiness, isComposioAuthReady } from "./composio-auth-readiness.js";

const config = (slug: string, custom = false, enabled = true) => ({
  toolkit: { slug },
  status: enabled ? "ENABLED" : "DISABLED",
  isEnabledForToolRouter: enabled,
  isComposioManaged: !custom,
});

describe("Composio deployment authentication readiness", () => {
  it("enables configured OAuth and user-key templates independently of user connections", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [config("GMAIL"), config("serpapi", true), config("twitter", true)],
    });
    const snapshot = await createComposioAuthReadiness(list).get();
    expect(isComposioAuthReady(snapshot, "gmail", false)).toBe(true);
    expect(isComposioAuthReady(snapshot, "SERPAPI", false)).toBe(true);
    expect(isComposioAuthReady(snapshot, "twitter", false)).toBe(true);
    expect(isComposioAuthReady(snapshot, "tiktok", false)).toBe(false);
    expect(isComposioAuthReady(snapshot, "public-feed", true)).toBe(true);
  });

  it("preserves disabled configs and refuses ambiguous custom credential selection", async () => {
    const snapshot = await createComposioAuthReadiness(async () => ({
      items: [
        config("disabled", false, false),
        config("public-feed", false, false),
        config("ambiguous", true),
        config("ambiguous", true),
        config("mixed"),
        config("mixed", true),
        { ...config("router-off"), isEnabledForToolRouter: false },
      ],
    })).get();
    for (const slug of ["disabled", "ambiguous", "router-off"])
      expect(isComposioAuthReady(snapshot, slug, false)).toBe(false);
    expect(isComposioAuthReady(snapshot, "public-feed", true)).toBe(false);
    expect(isComposioAuthReady(snapshot, "mixed", false)).toBe(true);
  });

  it("coalesces reads, follows pages, and observes configuration changes after the TTL", async () => {
    let time = 0;
    const list = vi
      .fn()
      .mockResolvedValueOnce({ items: [config("gmail")], nextCursor: "page-2" })
      .mockResolvedValueOnce({ items: [config("twitter", true)] })
      .mockResolvedValueOnce({ items: [config("tiktok", true)] });
    const cache = createComposioAuthReadiness(list, () => time);
    const [first, second] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(second);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1]?.[0].cursor).toBe("page-2");
    expect(await cache.get()).toBe(first);
    time = 60_001;
    const updated = await cache.get();
    expect(isComposioAuthReady(updated, "tiktok", false)).toBe(true);
    expect(isComposioAuthReady(updated, "gmail", false)).toBe(false);
  });

  it("rejects incomplete pagination instead of treating later apps as unavailable", async () => {
    const repeated = createComposioAuthReadiness(async () => ({
      items: [config("gmail")],
      nextCursor: "same-cursor",
    }));
    await expect(repeated.get()).rejects.toThrow("Repeated");
    let page = 0;
    const endless = createComposioAuthReadiness(async () => ({
      items: [],
      nextCursor: String(++page),
    }));
    await expect(endless.get()).rejects.toThrow("pagination limit");
  });

  it("does not retain a failure or share readiness between credential-bound instances", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        items: [config("gmail")],
      });
    const first = createComposioAuthReadiness(list);
    await expect(first.get()).rejects.toThrow("offline");
    expect(isComposioAuthReady(await first.get(), "gmail", false)).toBe(true);
    const otherCredential = createComposioAuthReadiness(async () => ({ items: [] }));
    expect(isComposioAuthReady(await otherCredential.get(), "gmail", false)).toBe(false);
  });
});
