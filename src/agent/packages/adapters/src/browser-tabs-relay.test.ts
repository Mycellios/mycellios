import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseBrowserTabsDispatch,
  parseBrowserTabsRegister,
  parseBrowserTabsResult,
} from "../../../../contracts/browser-tabs-bridge.js";
import { BrowserTabsBroker, BrowserTabsError } from "./browser-tabs-relay.js";

const owner = { userId: "user-1", sessionKey: "a".repeat(64) };
const generation = "11111111-1111-4111-8111-111111111111";
const never = new AbortController().signal;

describe("browser tabs broker", () => {
  let broker: BrowserTabsBroker;
  afterEach(() => broker?.close());

  it("delivers an operation to the registered panel and returns its result", async () => {
    broker = new BrowserTabsBroker();
    broker.register(owner, generation, { tabs: 1 });
    expect(broker.available(owner)).toBe(true);
    expect(broker.available({ ...owner, sessionKey: "b".repeat(64) })).toBe(false);
    const poll = broker.waitPoll(owner, generation, never, true);
    const pending = broker.dispatch(owner, { op: "list" }, never);
    const { operations } = await poll;
    expect(operations).toEqual([{ id: expect.any(String), request: { op: "list" } }]);
    broker.result(owner, generation, operations[0]!.id, { tabs: [], omitted: 2 });
    await expect(pending).resolves.toEqual({ tabs: [], omitted: 2 });
  });

  it("refuses work when the browser does not share, and caps concurrent operations", async () => {
    broker = new BrowserTabsBroker();
    await expect(broker.dispatch(owner, { op: "list" }, never)).rejects.toMatchObject({ code: "chrome_not_shared" });
    broker.register(owner, generation, { tabs: 1 });
    const pending = Array.from({ length: 4 }, () => broker.dispatch(owner, { op: "list" }, never).catch((error: unknown) => error));
    await expect(broker.dispatch(owner, { op: "list" }, never)).rejects.toMatchObject({ code: "chrome_busy", status: 429 });
    broker.revoke(owner);
    for (const result of await Promise.all(pending)) expect(result).toMatchObject({ code: "chrome_not_shared" });
  });

  it("never replays: work a panel received becomes uncertain when sharing stops", async () => {
    broker = new BrowserTabsBroker();
    broker.register(owner, generation, { tabs: 1 });
    const delivered = broker.dispatch(owner, { op: "list" }, never);
    await broker.waitPoll(owner, generation, never);
    const queued = broker.dispatch(owner, { op: "list" }, never);
    // Another panel takes over: nothing moves to it.
    broker.register(owner, "22222222-2222-4222-8222-222222222222", { tabs: 1 });
    await expect(delivered).rejects.toMatchObject({ code: "chrome_uncertain" });
    await expect(queued).rejects.toMatchObject({ code: "chrome_not_shared" });
    await expect(broker.waitPoll(owner, generation, never)).rejects.toBeInstanceOf(BrowserTabsError);
  });

  it("expires a panel that stops polling", async () => {
    let now = 1_000;
    broker = new BrowserTabsBroker(() => now);
    broker.register(owner, generation, { tabs: 1 });
    now += 91_000;
    expect(broker.available(owner)).toBe(false);
  });

  it("times out undelivered work as not shared and delivered work as uncertain", async () => {
    vi.useFakeTimers();
    try {
      broker = new BrowserTabsBroker();
      broker.register(owner, generation, { tabs: 1 });
      const undelivered = broker.dispatch(owner, { op: "list" }, never, 1_000).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await undelivered).toMatchObject({ code: "chrome_not_shared" });
      const delivered = broker.dispatch(owner, { op: "list" }, never, 1_000).catch((error: unknown) => error);
      await broker.waitPoll(owner, generation, never);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await delivered).toMatchObject({ code: "chrome_uncertain" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("browser tabs contract", () => {
  it("accepts the extension's real list result and keeps addresses to origin and path", async () => {
    const tabs = [
      { id: 3, windowId: 1, index: 1, active: false, audible: true, incognito: false, title: "Mail", url: "https://mail.example/inbox?token=secret#x" },
      { id: 7, windowId: 1, index: 0, active: true, audible: false, incognito: false, title: "Laptop", url: "https://shop.example/laptop?id=1" },
      { id: 9, windowId: 2, index: 0, active: true, audible: false, incognito: false, title: "Settings", url: "chrome://settings" },
      { id: 11, windowId: 3, index: 0, active: true, audible: false, incognito: true, title: "Private", url: "https://private.example/" },
    ];
    vi.stubGlobal("chrome", {
      permissions: { contains: async () => true },
      tabs: { query: async () => tabs },
      windows: { getLastFocused: async () => ({ id: 1 }) },
    });
    try {
      // @ts-expect-error The extension is plain JavaScript without declarations.
      const { listTabs } = await import("../../../apps/browser-extension/tabs-bridge.js");
      const result = await listTabs();
      const parsed = parseBrowserTabsResult({ generation, id: "33333333-3333-4333-8333-333333333333", result });
      expect(parsed.result).toEqual({
        tabs: [
          { tab: "t7", title: "Laptop", url: "https://shop.example/laptop", active: true, audible: false },
          { tab: "t3", title: "Mail", url: "https://mail.example/inbox", active: false, audible: true },
        ],
        omitted: 1,
      });
      vi.stubGlobal("chrome", { permissions: { contains: async () => false } });
      expect(await listTabs()).toEqual({ error: "tabs_permission_missing" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects extra fields, foreign addresses and unsigned shapes", () => {
    expect(() => parseBrowserTabsRegister({ generation, capabilities: { tabs: 1, act: 1 } })).toThrow();
    expect(() => parseBrowserTabsRegister({ generation, capabilities: { tabs: 1 }, code: "x" })).toThrow();
    const id = "33333333-3333-4333-8333-333333333333";
    expect(() => parseBrowserTabsResult({ generation, id, result: { tabs: [{ tab: "t1", title: "x", url: "javascript:alert(1)", active: true, audible: false }], omitted: 0 } })).toThrow();
    expect(parseBrowserTabsResult({ generation, id, result: { tabs: [{ tab: "t1", title: "x", url: "https://a.example/p?q=1", active: true, audible: false }], omitted: 0 } }).result)
      .toEqual({ tabs: [{ tab: "t1", title: "x", url: "https://a.example/p", active: true, audible: false }], omitted: 0 });
    expect(() => parseBrowserTabsDispatch({ scope: { userId: "u", sessionKey: "short" }, nonce: id, probe: "tabs" })).toThrow();
    expect(() => parseBrowserTabsDispatch({ scope: { userId: "u", sessionKey: "a".repeat(64) }, nonce: id, probe: "tabs", request: { op: "list" } })).toThrow();
    expect(() => parseBrowserTabsDispatch({ scope: { userId: "u", sessionKey: "a".repeat(64) }, nonce: id, request: { op: "click" } })).toThrow();
  });
});

describe("reading pages", () => {
  let broker: BrowserTabsBroker;
  afterEach(() => broker?.close());

  it("reads only through a panel that advertises reading, one read per tab", async () => {
    broker = new BrowserTabsBroker();
    broker.register(owner, generation, { tabs: 1 });
    await expect(broker.dispatch(owner, { op: "snapshot", tab: "t1" }, never)).rejects.toMatchObject({ code: "chrome_not_shared" });
    broker.register(owner, generation, { tabs: 1, read: 1 });
    const first = broker.dispatch(owner, { op: "snapshot", tab: "t1" }, never);
    await expect(broker.dispatch(owner, { op: "snapshot", tab: "t1" }, never)).rejects.toMatchObject({ code: "chrome_busy" });
    const { operations } = await broker.waitPoll(owner, generation, never);
    const page = { title: "Laptop", url: "https://shop.example/laptop", text: "Price 900", truncated: false };
    broker.result(owner, generation, operations[0]!.id, { page });
    await expect(first).resolves.toEqual({ page });
  });

  it("parses snapshot requests and page results strictly", () => {
    const id = "33333333-3333-4333-8333-333333333333";
    expect(parseBrowserTabsRegister({ generation, capabilities: { tabs: 1, read: 1 } }).capabilities).toEqual({ tabs: 1, read: 1 });
    expect(() => parseBrowserTabsDispatch({ scope: { userId: "u", sessionKey: "a".repeat(64) }, nonce: id, request: { op: "snapshot", tab: "1" } })).toThrow();
    expect(parseBrowserTabsDispatch({ scope: { userId: "u", sessionKey: "a".repeat(64) }, nonce: id, request: { op: "snapshot", tab: "t12" } }).request)
      .toEqual({ op: "snapshot", tab: "t12" });
    expect(parseBrowserTabsResult({ generation, id, result: { page: { title: "x", url: "https://a.example/p?token=1", text: "hi", truncated: false } } }).result)
      .toEqual({ page: { title: "x", url: "https://a.example/p", text: "hi", truncated: false } });
    expect(() => parseBrowserTabsResult({ generation, id, result: { page: { title: "x", url: "https://a.example/", text: "x".repeat(48_001), truncated: true } } })).toThrow();
    expect(() => parseBrowserTabsResult({ generation, id, result: { error: "declined", page: {} } })).toThrow();
    expect(parseBrowserTabsResult({ generation, id, result: { error: "consent_timeout" } }).result).toEqual({ error: "consent_timeout" });
    expect(() => parseBrowserTabsResult({ generation, id, result: { error: "anything" } })).toThrow();
  });

  describe("the extension's site question", () => {
    const load = async () => {
      // @ts-expect-error The extension is plain JavaScript without declarations.
      return (await import("../../../apps/browser-extension/tabs-bridge.js")) as { snapshotTab(tab: string, ask: (q: { site: string }) => Promise<string>): Promise<unknown> };
    };
    const stub = (url: string, granted: boolean, href = url) => {
      const chrome = {
        tabs: { get: vi.fn(async () => ({ id: 5, url, incognito: false })) },
        permissions: { contains: vi.fn(async () => granted), remove: vi.fn(async () => true) },
        scripting: { executeScript: vi.fn(async () => [{ result: { title: "Shop", href, text: "Price 900", truncated: false } }]) },
      };
      vi.stubGlobal("chrome", chrome);
      return chrome;
    };
    afterEach(() => vi.unstubAllGlobals());

    it("never reads Mycellios, the Web Store or password managers, and asks nothing", async () => {
      const { snapshotTab } = await load();
      const ask = vi.fn(async () => "always");
      for (const url of ["https://www.mycellios.com/agent/app", "https://chromewebstore.google.com/detail/x", "https://vault.bitwarden.com/", "chrome://settings"]) {
        const chrome = stub(url, true);
        expect(await snapshotTab("t5", ask)).toMatchObject({ error: expect.stringMatching(/refused_site|not_web_page/) });
        expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
      }
      expect(ask).not.toHaveBeenCalled();
    });

    it("asks before a new site and respects a refusal", async () => {
      const { snapshotTab } = await load();
      const chrome = stub("https://shop.example/laptop?id=9", false);
      const ask = vi.fn(async () => "deny");
      expect(await snapshotTab("t5", ask)).toEqual({ error: "declined" });
      expect(ask).toHaveBeenCalledWith({ site: "shop.example", origins: ["https://shop.example/*"] });
      expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    });

    it("removes a one-time grant after reading and parses as a page result", async () => {
      const { snapshotTab } = await load();
      const chrome = stub("https://shop.example/laptop?id=9", false);
      const result = await snapshotTab("t5", async () => "once");
      expect(chrome.permissions.remove).toHaveBeenCalledWith({ origins: ["https://shop.example/*"] });
      expect(parseBrowserTabsResult({ generation, id: "33333333-3333-4333-8333-333333333333", result }).result)
        .toEqual({ page: { title: "Shop", url: "https://shop.example/laptop", text: "Price 900", truncated: false } });
    });

    it("does not ask for an allowed site, and refuses a tab that moved elsewhere", async () => {
      const { snapshotTab } = await load();
      const ask = vi.fn(async () => "deny");
      stub("https://shop.example/a", true, "https://evil.example/");
      expect(await snapshotTab("t5", ask)).toEqual({ error: "tab_changed" });
      expect(ask).not.toHaveBeenCalled();
    });
  });
});
