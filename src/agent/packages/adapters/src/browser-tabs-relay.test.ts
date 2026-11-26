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
    expect(() => parseBrowserTabsRegister({ generation, capabilities: { tabs: 1, read: 1 } })).toThrow();
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
