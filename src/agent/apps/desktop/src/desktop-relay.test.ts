import { afterEach, expect, it, vi } from "vitest";
import { DesktopRelayClient, missingOperationAction, pollRetryDelayMs, relayConflictMessage } from "./desktop-relay.js";

it("explains a relay conflict with the server's sentence, never by asking to sign in again", async () => {
  const busy = "This Mico is working on another computer. Wait for it to finish there, or stop it, then try again.";
  expect(await relayConflictMessage(Response.json({ error: busy }, { status: 409 }))).toBe(busy);
  const neutral = "The PC connection changed. Try again.";
  expect(await relayConflictMessage(new Response("not json", { status: 409 }))).toBe(neutral);
  expect(await relayConflictMessage(Response.json({ error: "x".repeat(201) }, { status: 409 }))).toBe(neutral);
  expect(await relayConflictMessage(Response.json({ error: "line\nbreak" }, { status: 409 }))).toBe(neutral);
});

it("shows the server's reason when connecting a Mico another PC is running", async () => {
  const busy = "This Mico is working on another computer. Wait for it to finish there, or stop it, then try again.";
  const client = new DesktopRelayClient({
    base: "https://example.test",
    localUrl: "http://127.0.0.1:1234",
    localToken: "unused",
    revoked: vi.fn(),
    fetch: async () => Response.json({ error: busy, code: "busy_elsewhere" }, { status: 409 }),
  });
  try {
    await expect(client.identity()).rejects.toThrow(busy);
  } finally { client.stop(); }
});

it("forgets a settled delivery and still aborts an unsettled orphan", () => {
  const settled = new Set(["done"]);
  expect(missingOperationAction("done", ["done"], settled)).toBe("keep");
  expect(missingOperationAction("done", [], settled)).toBe("forget");
  expect(missingOperationAction("orphan", [], settled)).toBe("abort");
});

it("backs off failed polls instead of retrying at once, up to five seconds", () => {
  expect([0, 1, 2, 3, 4, 5, 6, 12].map((failures) => pollRetryDelayMs(failures, true))).toEqual([
    0, 250, 500, 1_000, 2_000, 4_000, 5_000, 5_000,
  ]);
  // Without agent execution the ordinary 2 s poll interval is already the floor.
  expect([0, 1, 4, 5, 9].map((failures) => pollRetryDelayMs(failures, false))).toEqual([
    2_000, 2_000, 2_000, 4_000, 5_000,
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("holds project polls open while the server lists the PC's bindings, and rebinds only what it lost", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const polls: (boolean | undefined)[] = [];
  const binds: string[] = [];
  const bound = new Set<string>();
  let generation: string | undefined;
  let fail = false;
  let failedAt = -1;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234", localToken: "unused", revoked: vi.fn(),
    deviceId: "11111111-1111-4111-8111-111111111111",
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      const payload = JSON.parse(String(init?.body ?? "{}"));
      if (action === "identity") return Response.json(identity);
      if (action === "bind") {
        binds.push(payload.botId);
        bound.add(payload.botId);
        generation = payload.generation;
        return Response.json({ ok: true });
      }
      if (action === "poll") {
        polls.push(payload.wait);
        // The server holds a waiting poll until work arrives or its window ends.
        if (payload.wait) await new Promise(resolve => setTimeout(resolve, 20));
        if (fail) {
          fail = false;
          failedAt = polls.length - 1;
          return new Response(null, { status: 409 });
        }
        return Response.json({
          identity, active: [], operations: [],
          bindings: [...bound].map(botId => ({ deviceId: payload.deviceId, botId, generation })),
        });
      }
      throw new Error(`unexpected ${action}`);
    },
  });
  try {
    await client.bind("bot");
    await vi.waitFor(() => expect(polls.filter(Boolean).length).toBeGreaterThanOrEqual(3));
    // The first poll learns the server's bindings; later ones wait without rebinding.
    expect(polls[0]).toBeUndefined();
    expect(binds).toEqual(["bot"]);
    // An API restart lost the binding: reassert that one grant once, then wait again.
    bound.clear();
    await vi.waitFor(() => expect(binds).toEqual(["bot", "bot"]));
    const afterRebind = polls.length;
    await vi.waitFor(() => expect(polls.slice(afterRebind).some(Boolean)).toBe(true));
    // After a failure the next poll does not wait, so lost bindings are listed first.
    fail = true;
    await vi.waitFor(() => {
      expect(failedAt).toBeGreaterThanOrEqual(0);
      expect(polls.length).toBeGreaterThan(failedAt + 1);
    }, { timeout: 4_000 });
    expect(polls[failedAt + 1]).toBeUndefined();
  } finally { client.stop(); }
});

it("tells the server once that a connected PC is going offline, without treating a refusal as revocation", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const released: unknown[] = [];
  const revoked = vi.fn();
  let polled = false;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234", localToken: "unused", revoked,
    deviceId: "11111111-1111-4111-8111-111111111111",
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      if (action === "identity") return Response.json(identity);
      if (action === "bind") return Response.json({ ok: true });
      if (action === "poll") { polled = true; return Response.json({ identity, active: [], operations: [] }); }
      if (action === "release") { released.push(JSON.parse(String(init?.body))); return new Response(null, { status: 401 }); }
      throw new Error(`unexpected ${action}`);
    },
  });
  const offlineFetch = vi.fn<typeof fetch>();
  const offline = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "", localToken: "", revoked, fetch: offlineFetch,
  });
  expect(offline.release()).toBeUndefined();
  expect(offlineFetch).not.toHaveBeenCalled();
  await client.bind("bot");
  await vi.waitFor(() => expect(polled).toBe(true));
  await vi.waitFor(() => expect(client.online()).toBe(true));
  const release = client.release();
  expect(release).toBeInstanceOf(Promise);
  expect(client.release()).toBeUndefined();
  await release;
  expect(released).toEqual([{ deviceId: "11111111-1111-4111-8111-111111111111" }]);
  expect(client.online()).toBe(false);
  expect(revoked).not.toHaveBeenCalled();
});

it("still executes a newly delivered operation if the API rejects an orphan report", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const local = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"done":true}\n'));
  const reports: { id: string; done: boolean }[] = [];
  let binding: unknown;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234",
    localToken: "unused", revoked: vi.fn(),
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      const payload = JSON.parse(String(init?.body));
      if (action === "identity") return Response.json(identity);
      if (action === "bind") {
        binding = payload;
        return Response.json({ ok: true });
      }
      if (action === "poll") {
        return Response.json({
          identity, active: ["orphan", "fresh"],
          operations: [{ id: "fresh", binding, request: { method: "environment", botId: "bot" } }],
        });
      }
      reports.push({ id: payload.id, done: payload.done });
      return new Response(null, { status: payload.id === "orphan" ? 409 : 200 });
    },
  });
  try {
    await client.bind("bot");
    await vi.waitFor(() => expect(reports).toContainEqual({ id: "fresh", done: true }), { timeout: 3_000 });
    expect(reports[0]).toEqual({ id: "orphan", done: true });
    expect(local).toHaveBeenCalledOnce();
  } finally { client.stop(); }
});

it("stops local work and stops posting when the API no longer holds the operation", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  let localSignal: AbortSignal | undefined;
  // A long local stream: one frame now, more later, unless aborted.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    localSignal = init?.signal ?? undefined;
    const encoder = new TextEncoder();
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"event":1}\n'));
        localSignal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      },
    }));
  });
  const reports: { id: string; seq: number; done: boolean }[] = [];
  let binding: unknown;
  let delivered = false;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234",
    localToken: "unused", revoked: vi.fn(),
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      const payload = JSON.parse(String(init?.body));
      if (action === "identity") return Response.json(identity);
      if (action === "bind") { binding = payload; return Response.json({ ok: true }); }
      if (action === "poll") {
        const operations = delivered || !binding ? [] : [{ id: "cancelled", binding, request: { method: "environment", botId: "bot" } }];
        if (operations.length) delivered = true;
        return Response.json({ identity, active: [], operations });
      }
      reports.push({ id: payload.id, seq: payload.seq, done: payload.done });
      return new Response(null, { status: 409 });
    },
  });
  try {
    await client.bind("bot");
    await vi.waitFor(() => expect(localSignal?.aborted).toBe(true), { timeout: 3_000 });
    await new Promise(resolve => setTimeout(resolve, 200));
    // One rejected frame; no retries and no extra failure report for a discarded operation.
    expect(reports).toEqual([{ id: "cancelled", seq: 0, done: false }]);
  } finally { client.stop(); }
});

it("sends the lines that arrive during a result POST together in the next one", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  let emit!: (line: string) => void;
  let finish!: () => void;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      emit = line => controller.enqueue(new TextEncoder().encode(line));
      finish = () => controller.close();
    },
  })));
  const reports: { seq: number; done: boolean; text: string }[] = [];
  let release!: () => void;
  const firstPost = new Promise<void>(resolve => { release = resolve; });
  let binding: unknown;
  let delivered = false;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234",
    localToken: "unused", revoked: vi.fn(),
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      const payload = JSON.parse(String(init?.body));
      if (action === "identity") return Response.json(identity);
      if (action === "bind") { binding = payload; return Response.json({ ok: true }); }
      if (action === "poll") {
        const operations = delivered || !binding ? [] : [{ id: "busy", binding, request: { method: "environment", botId: "bot" } }];
        if (operations.length) delivered = true;
        return Response.json({ identity, active: delivered ? ["busy"] : [], operations });
      }
      reports.push({ seq: payload.seq, done: payload.done, text: Buffer.from(payload.data, "base64").toString() });
      // The first result POST is slow; everything emitted meanwhile must wait for the next one.
      if (payload.seq === 0) await firstPost;
      return Response.json({ ok: true });
    },
  });
  try {
    await client.bind("bot");
    await vi.waitFor(() => expect(emit).toBeTypeOf("function"), { timeout: 3_000 });
    emit('{"n":1}\n');
    await vi.waitFor(() => expect(reports).toHaveLength(1), { timeout: 3_000 });
    for (let n = 2; n <= 6; n++) emit(`{"n":${n}}\n`);
    finish();
    await new Promise(resolve => setTimeout(resolve, 50));
    release();
    await vi.waitFor(() => expect(reports.at(-1)?.done).toBe(true), { timeout: 3_000 });
    expect(reports.map(({ seq, done }) => [seq, done])).toEqual([[0, false], [1, true]]);
    expect(reports.map(report => report.text).join("")).toBe([1, 2, 3, 4, 5, 6].map(n => `{"n":${n}}\n`).join(""));
  } finally { client.stop(); }
});

it("keeps running work through a stalled server by resending the same frame", async () => {
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  let localSignal: AbortSignal | undefined;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    localSignal = init?.signal ?? undefined;
    return new Response('{"event":1}\n{"event":2}\n');
  });
  const reports: { seq: number; done: boolean; text: string }[] = [];
  let binding: unknown;
  let delivered = false;
  let stalls = 2;
  const client = new DesktopRelayClient({
    base: "https://example.test/agent", localUrl: "http://127.0.0.1:1234",
    localToken: "unused", revoked: vi.fn(),
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      const payload = JSON.parse(String(init?.body));
      if (action === "identity") return Response.json(identity);
      if (action === "bind") { binding = payload; return Response.json({ ok: true }); }
      if (action === "poll") {
        const operations = delivered || !binding ? [] : [{ id: "slow", binding, request: { method: "environment", botId: "bot" } }];
        if (operations.length) delivered = true;
        return Response.json({ identity, active: delivered ? ["slow"] : [], operations });
      }
      reports.push({ seq: payload.seq, done: payload.done, text: Buffer.from(payload.data, "base64").toString() });
      // The first frame meets a stalled API twice: one timeout, one gateway error.
      if (payload.seq === 0 && stalls-- > 0) {
        if (stalls === 1) throw new DOMException("slow relay", "TimeoutError");
        return new Response(null, { status: 503 });
      }
      return Response.json({ ok: true });
    },
  });
  try {
    await client.bind("bot");
    await vi.waitFor(() => expect(reports.length).toBeGreaterThanOrEqual(3), { timeout: 8_000 });
    // The output and its end travel in one frame, resent unchanged through the stall.
    expect(reports.map(({ seq, done }) => [seq, done])).toEqual([[0, true], [0, true], [0, true]]);
    expect(new Set(reports.map(report => report.text))).toEqual(new Set(['{"event":1}\n{"event":2}\n']));
    expect(reports.some(report => report.text.includes("interrupted"))).toBe(false);
    expect(localSignal?.aborted).toBe(false);
  } finally { client.stop(); }
}, 10_000);

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
    // A failed poll waits at most the 5 s retry cap before trying again.
    const before = binds; offline = false; await vi.advanceTimersByTimeAsync(5_000);
    expect(client.connected("bot")).toBe(true); expect(binds).toBeGreaterThan(before);
  } finally { client.stop(); }
});

it("does not publish account presence after being stopped during identity admission",async()=>{
 let resolve!:(r:Response)=>void;const actions:string[]=[];
 const identity={userId:"owner",spaceId:"space",connectionId:"session"};
 const client=new DesktopRelayClient({base:"https://example.test",localUrl:"http://127.0.0.1:1234",localToken:"unused",revoked:vi.fn(),fetch:async(url)=>{actions.push(url);return new Promise<Response>(r=>{resolve=r;});}});
 const registration=client.registerAccount(identity);client.stop();resolve(Response.json(identity));
 await expect(registration).rejects.toThrow("session changed");expect(client.online()).toBe(false);expect(actions).toHaveLength(1);
});
it("re-registers account presence after an API restart without binding arbitrary agents or replaying work",async()=>{
 vi.useFakeTimers();vi.setSystemTime(50000);
 const identity={userId:"owner",spaceId:"space",connectionId:"session"};let registrations:unknown[]=[];
 const client=new DesktopRelayClient({base:"https://example.test",localUrl:"http://127.0.0.1:1234",localToken:"unused",revoked:vi.fn(),fetch:async(url,init)=>{
  const action=url.split("/").at(-1);if(action==="account")registrations.push(JSON.parse(String(init?.body)));
  return Response.json(action==="identity"?identity:{identity,bindings:[],active:[],operations:[]});
 }});
 try{await client.registerAccount(identity);expect(client.online()).toBe(true);expect(client.connected("unowned")).toBe(false);
  await vi.advanceTimersByTimeAsync(6000);expect(registrations.length).toBeGreaterThan(1);expect(registrations.every(x=>JSON.stringify(x)===JSON.stringify(registrations[0]))).toBe(true);
  client.stop();const count=registrations.length;await vi.advanceTimersByTimeAsync(6000);expect(registrations).toHaveLength(count);
 }finally{client.stop();}
});

it("restores every owned legacy Mico generation on the same PC after a planned update", async () => {
  const identity={userId:"owner",spaceId:"space",connectionId:"session"},deviceId="planned-device";
  const grants=new Map([['one','generation-one'],['two','generation-two']]);
  const bindings:Array<{botId:string;deviceId:string;generation:string}>=[];
  const client=new DesktopRelayClient({base:"https://example.test/agent",localUrl:"http://127.0.0.1:1234",localToken:"unused",revoked:vi.fn(),
    restoreUpdate:async(id,botId)=>botId&&grants.has(botId)?{base:"https://example.test/agent",...id,deviceId,botId,generation:grants.get(botId)!}:undefined,
    fetch:async(url,init)=>{
      const action=url.split("/").at(-1);
      if(action==="bind")bindings.push(JSON.parse(String(init?.body)));
      return Response.json(action==="identity"?identity:action==="poll"?{identity,active:[],operations:[]}:{ok:true});
    }});
  try {
    await client.bind("one");await client.bind("two");
    expect(bindings).toEqual([{botId:"one",deviceId,generation:"generation-one"},{botId:"two",deviceId,generation:"generation-two"}]);
    expect(client.resumeBindings()).toHaveLength(2);
    await client.bind("two",true);
    expect(bindings.at(-1)?.generation).not.toBe("generation-two");
  } finally {client.stop();}
});

it("stays online when a poll also lists another desktop", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(50_000);
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const revoked = vi.fn();
  const mine = "11111111-1111-4111-8111-111111111111";
  const client = new DesktopRelayClient({
    base: "https://example.test",
    localUrl: "http://127.0.0.1:1234",
    localToken: "unused",
    deviceId: mine,
    revoked,
    fetch: async (url) => {
      const action = url.split("/").at(-1);
      return Response.json(action === "identity" ? identity : {
        identity,
        bindings: [
          { deviceId: "22222222-2222-4222-8222-222222222222", botId: "other", generation: "33333333-3333-4333-8333-333333333333" },
          { deviceId: mine, botId: "mine", generation: "44444444-4444-4444-8444-444444444444" },
        ],
        active: [],
        operations: [],
      });
    },
  });
  try {
    await client.registerAccount(identity);
    expect(client.online()).toBe(true);
    expect(client.connected("mine")).toBe(true);
    expect(client.connected("other")).toBe(false);
    expect(revoked).not.toHaveBeenCalled();
  } finally { client.stop(); }
});

it("reports this PC's Mico folders only to a server that asks for them and stops after a refusal", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(50_000);
  const identity = { userId: "owner", spaceId: "space", connectionId: "session" };
  const folder = "a".repeat(64);
  const registrations: Array<Record<string, unknown>> = [];
  let ownership = true;
  let refuse = false;
  const client = new DesktopRelayClient({
    base: "https://example.test",
    localUrl: "http://127.0.0.1:1234",
    localToken: "unused",
    revoked: vi.fn(),
    workspaces: () => [folder, "Not a key"],
    fetch: async (url, init) => {
      const action = url.split("/").at(-1);
      if (action === "identity") return Response.json(identity);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      registrations.push(body);
      // An older API behind the same address refuses the unknown field.
      if (refuse && "workspaces" in body) return Response.json({ error: "PC connection changed." }, { status: 409 });
      return Response.json({ identity, bindings: [], active: [], operations: [], ...(ownership ? { ownership: 1 } : {}) });
    },
  });
  try {
    await client.registerAccount(identity);
    expect(registrations[0]).not.toHaveProperty("workspaces");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(registrations.at(-1)).toMatchObject({ workspaces: [folder] });
    refuse = true;
    ownership = false;
    const before = registrations.length;
    await vi.advanceTimersByTimeAsync(6_000);
    const after = registrations.slice(before);
    expect(after[0]).toHaveProperty("workspaces");
    expect(after.length).toBeGreaterThan(1);
    expect(after.slice(1).some((body) => "workspaces" in body)).toBe(false);
    expect(client.online()).toBe(true);
  } finally { client.stop(); }
});
