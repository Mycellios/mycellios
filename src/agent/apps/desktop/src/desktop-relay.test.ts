import { afterEach, expect, it, vi } from "vitest";
import { DesktopRelayClient } from "./desktop-relay.js";

afterEach(() => vi.useRealTimers());

it("retries one timed-out identity read without repeating an operation", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const fetch = vi.fn().mockRejectedValueOnce(new DOMException("slow identity", "TimeoutError")).mockResolvedValueOnce(Response.json(identity));
  const revoked = vi.fn();
  const client = new DesktopRelayClient({base:"https://example.test/agent", localUrl:"http://127.0.0.1:1234",localToken:"unused",fetch,revoked});
  expect(await client.identity()).toEqual(identity);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith("/identity"))).toBe(true);
  expect(revoked).not.toHaveBeenCalled();
  client.stop();
});

it.each([401, 403, "timeout"])("keeps identity retry bounded and rejects %s", async (failure) => {
  const fetch = failure === "timeout" ? vi.fn().mockRejectedValue(new DOMException("slow identity", "TimeoutError")) : vi.fn().mockResolvedValue(new Response(null,{status:failure}));
  const revoked = vi.fn();
  const client = new DesktopRelayClient({base:"https://example.test/agent",localUrl:"http://127.0.0.1:1234",localToken:"unused",fetch,revoked});
  await expect(client.identity()).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(failure === "timeout" ? 2 : 1);
  expect(revoked).toHaveBeenCalledTimes(failure === "timeout" ? 0 : 1);
  expect(client.connected("bot")).toBe(false);
  client.stop();
});

it("revokes an existing binding when a retried identity belongs to another session", async () => {
  let identity = { userId:"owner",spaceId:"space",connectionId:"session" }, timeout = false;
  const revoked = vi.fn();
  const client = new DesktopRelayClient({base:"https://example.test/agent",localUrl:"http://127.0.0.1:1234",localToken:"unused",revoked,fetch:async(url)=>{
    const action=url.split("/").at(-1);
    if(action === "identity" && timeout){timeout=false;throw new DOMException("slow identity","TimeoutError");}
    return Response.json(action === "identity" ? identity : action === "poll" ? {identity,active:[],operations:[]} : {ok:true});
  }});
  try {
    await client.bind("bot");expect(client.connected("bot")).toBe(true);
    identity={...identity,connectionId:"another-session"};timeout=true;
    await client.identity();
    expect(client.connected("bot")).toBe(false);expect(revoked).toHaveBeenCalledOnce();
  }finally{client.stop();}
});

it("tracks only owned native bindings and forgets them on revocation or account change", async () => {
  let identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const revoked = vi.fn();
  const calls: string[] = [];
  const bindings: unknown[] = [];
  const client = new DesktopRelayClient({
    base: "https://example.test/agent",
    localUrl: "http://127.0.0.1:1234",
    localToken: "unused",
    revoked,
    fetch: async (url, init) => {
      const action = url.split("/").at(-1)!;
      calls.push(action);
      if (action === "bind") bindings.push(JSON.parse(String(init?.body)));
      return Response.json(
        action === "identity"
          ? identity
          : action === "poll"
            ? { identity, active: [], operations: [] }
            : { ok: true },
      );
    },
  });
  try {
    expect(client.connected("bot")).toBe(false);
    await client.bind("bot");
    expect(client.connected("bot")).toBe(true);
    expect(client.connected("other")).toBe(false);
    await client.bind("bot");
    expect(calls.filter((action) => action === "bind")).toHaveLength(2);
    expect(bindings[1]).toEqual(bindings[0]); // Reconnect with the same generation, no command replay.
    identity = { ...identity, userId: "different-owner" };
    await client.identity();
    expect(client.connected("bot")).toBe(false);
    expect(revoked).toHaveBeenCalledOnce();
    await client.revoke();
    expect(client.connected("bot")).toBe(false);
  } finally {
    client.stop();
  }
});

it("restores an approved binding after the API forgets it without replaying work", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(50_000);
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  let online = new Map<string, unknown>();
  const bindings: unknown[] = [];
  const calls: string[] = [];
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234", localToken: "unused",
    revoked: vi.fn(),
    fetch: async (url, init) => {
      const action = url.split("/").at(-1)!; calls.push(action);
      if (action === "bind") { const value = JSON.parse(String(init?.body)); bindings.push(value); online.set(value.botId, value); }
      return Response.json(action === "identity" ? identity : action === "poll" ? { identity, active: [], operations: [] } : { ok: true });
    },
  });
  try {
    await client.bind("bot");
    await vi.advanceTimersByTimeAsync(2_000);
    online = new Map(); // The server restarted; the native consent did not change.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(online.get("bot")).toEqual(bindings[0]);
    expect(bindings.every(value => JSON.stringify(value) === JSON.stringify(bindings[0]))).toBe(true);
    expect(client.connected("bot")).toBe(true);
    expect(calls).not.toContain("result");
    await client.revoke();
    const count = bindings.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(bindings).toHaveLength(count);
  } finally { client.stop(); }
});

it("stops rather than restoring bindings under a changed account", async () => {
  vi.useFakeTimers(); vi.setSystemTime(50_000);
  let identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const revoked = vi.fn(); let binds = 0;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234", localToken: "unused", revoked,
    fetch: async (url) => { const action = url.split("/").at(-1); if (action === "bind") binds++;
      return Response.json(action === "identity" ? identity : action === "poll" ? { identity, active: [], operations: [] } : { ok: true }); },
  });
  try {
    await client.bind("bot"); await vi.advanceTimersByTimeAsync(2_000); const before = binds;
    identity = { ...identity, connectionId: "new-session" };
    await vi.advanceTimersByTimeAsync(20_000);
    expect(binds).toBe(before); expect(client.connected("bot")).toBe(false); expect(revoked).toHaveBeenCalledOnce();
  } finally { client.stop(); }
});

it("recovers after a long network outage but does not claim a live connection while offline", async () => {
  vi.useFakeTimers(); vi.setSystemTime(50_000);
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const revoked = vi.fn(); let offline = false; let binds = 0;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234", localToken: "unused", revoked,
    fetch: async (url) => { if (offline) throw new Error("Network unavailable"); const action = url.split("/").at(-1); if (action === "bind") binds++;
      return Response.json(action === "identity" ? identity : action === "poll" ? { identity, active: [], operations: [] } : { ok: true }); },
  });
  try {
    await client.bind("bot"); await vi.advanceTimersByTimeAsync(2_000);
    offline = true; await vi.advanceTimersByTimeAsync(50_000);
    expect(client.connected("bot")).toBe(false); expect(revoked).not.toHaveBeenCalled();
    const before = binds; offline = false; await vi.advanceTimersByTimeAsync(2_000);
    expect(client.connected("bot")).toBe(true); expect(binds).toBeGreaterThan(before);
  } finally { client.stop(); }
});
