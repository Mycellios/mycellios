import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerUpdatingError, DesktopUnreachableError } from "./computer-errors.js";
import { DESKTOP_RELAY_HANDOFF_MS, DesktopRelayBroker, desktopAgentSelection, desktopDeviceKey, desktopRelayAvailable, desktopRelayKey, desktopRelayPresence, signDesktopRelay, verifyDesktopRelay } from "./desktop-relay.js";
const owner = { userId: "user", spaceId: "space", sessionId: "session" };
const binding = { deviceId: "device", botId: "bot", generation: "generation" };
const context = () => ({ userId: "user", spaceId: "space", botId: "bot", operationId: "op", traceId: "trace", signal: new AbortController().signal });
let broker: DesktopRelayBroker;
afterEach(() => broker?.close());
describe("outbound Desktop relay", () => {
  it("binds and routes only the exact account, space, session and device", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    expect(broker.available({ ...owner, spaceId: "other" }, "bot")).toBe(false);
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    expect(broker.poll({ ...owner, sessionId: "other" }, "device").operations).toEqual([]);
    const state = broker.poll(owner, "device");
    expect(state.operations).toHaveLength(1);
    expect(broker.poll(owner, "device").operations).toEqual([]);
    const id = state.operations[0]!.id;
    expect(() => broker.result({ ...owner, userId: "attacker" }, "device", id, 0, "", true)).toThrow();
    broker.result(owner, "device", id, 0, Buffer.from('{"value":1}\n{"done":true}\n').toString("base64"), true);
    expect(await response.text()).toContain('"value":1');
  });
  it("never reclaims commands after a lost poll, and deduplicates result acknowledgement", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "execute", botId: "bot", command: { argv: ["test"] } }, context());
    const id = broker.poll(owner, "device").operations[0]!.id;
    expect(broker.poll(owner, "device")).toMatchObject({ operations: [], active: [id] });
    const data = Buffer.from('{"done":true}\n').toString("base64");
    broker.result(owner, "device", id, 0, data, true); broker.result(owner, "device", id, 0, data, true);
    expect(await response.text()).toBe('{"done":true}\n');
    // A Desktop 0.3.24 poll can still hold a snapshot from before completion.
    const stale = Buffer.from('{"error":"Desktop delivery was interrupted. Check results before retrying."}\n').toString("base64");
    expect(() => broker.result(owner, "device", id, 0, stale, true)).not.toThrow();
    expect(() => broker.result(owner, "device", id, 0, "", true)).toThrow();
  });
  it("does not stop a quiet long command while authenticated Desktop heartbeats continue", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "execute", botId: "bot", command: { argv: ["render"], timeoutMs: 3_600_000 } }, context());
    const id = broker.poll(owner, "device").operations[0]!.id;
    for (let i = 0; i < 400; i++) { now += 30_000; expect(broker.poll(owner, "device").active).toEqual([id]); }
    broker.result(owner, "device", id, 0, Buffer.from('{"done":true}\n').toString("base64"), true);
    expect(await response.text()).toContain("done");
  });
  it("keeps a streaming operation alive while its results arrive between polls", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    const id = broker.poll(owner, "device").operations[0]!.id;
    const chunk = Buffer.from('{"progress":1}\n').toString("base64");
    for (let seq = 0; seq < 3; seq++) { now += 30_000; broker.result(owner, "device", id, seq, chunk, false); }
    expect(broker.available(owner, "bot")).toBe(true);
    broker.result(owner, "device", id, 3, Buffer.from('{"done":true}\n').toString("base64"), true);
    expect(await response.text()).toContain("done");
  });
  it("expires disconnected work and never moves an active agent to a different PC", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    // The API turns this exact reason into "working on another computer", not "sign in again".
    expect(() => broker.bind(owner, { ...binding, deviceId: "other" })).toThrow("Agent busy on another computer");
    expect(broker.poll(owner, "device").operations).toHaveLength(1);
    now = 91_000;
    expect(broker.available(owner, "bot")).toBe(false);
    expect(await response.text()).toContain("disconnected");
    expect(() => broker.dispatch({ method: "environment", botId: "bot" }, context())).toThrow();
  });
  it("revokes and cancels the exact device without cancelling another agent", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    broker.bind(owner, { ...binding, botId: "other", deviceId: "other-device" });
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    broker.revoke(owner, "device");
    expect(await response.text()).toContain("revoked");
    expect(broker.available(owner, "other")).toBe(true);
  });
  it("does not resume an old run against a newly selected project generation", async () => {
    broker = new DesktopRelayBroker(); broker.bind(owner, binding);
    const response = broker.dispatch({ method: "environment", botId: "bot", runId: "original-run" }, context());
    broker.revoke(owner, "device"); await response.text();
    broker.bind(owner, { ...binding, generation: "replacement" });
    expect(() => broker.dispatch({ method: "environment", botId: "bot", runId: "original-run" }, context())).toThrow("previous project");
  });
  it("authenticates internal scope and body using a purpose-specific key and freshness", () => {
    const key = desktopRelayKey("operator-secret"); const timestamp = String(Date.now());
    const signature = signDesktopRelay(key, timestamp, "body");
    expect(verifyDesktopRelay(key, timestamp, "body", signature)).toBe(true);
    expect(verifyDesktopRelay(key, timestamp, "altered", signature)).toBe(false);
    expect(verifyDesktopRelay("operator-secret", timestamp, "body", signature)).toBe(false);
    expect(verifyDesktopRelay(key, timestamp, "body", signature, Date.now() + 60_000)).toBe(false);
  });
});

it("lazily admits all owned bots on one paired PC and expires offline presence",()=>{
 let now=1000;broker=new DesktopRelayBroker(()=>now);
 broker.register(owner,binding);broker.connectAccountBot(owner,"unopened");
 expect(broker.available(owner,"unopened")).toBe(true);
 broker.connectAccountBot({...owner,userId:"other"},"unopened");
 expect(broker.available({...owner,userId:"other"},"unopened")).toBe(false);
 broker.register(owner,{...binding,deviceId:"different-pc"});
 expect(broker.available(owner,"unopened")).toBe(true);
 now+=91000;expect(broker.available(owner,"unopened")).toBe(false);
 broker.connectAccountBot(owner,"new");expect(broker.available(owner,"new")).toBe(false);
 broker.register(owner,binding);broker.connectAccountBot(owner,"new");
 expect(broker.available(owner,"new")).toBe(true);
});
it("rotates a restarted native account without replaying an interrupted run",async()=>{
 broker=new DesktopRelayBroker();broker.register(owner,binding);broker.connectAccountBot(owner,"bot");
 const response=broker.dispatch({method:"environment",botId:"bot",runId:"old-run"},context());
 expect(broker.poll(owner,"device").operations).toHaveLength(1);
 const next={...owner,sessionId:"new-session"};
 broker.register(next,{...binding,generation:"next-generation"});
 expect(await response.text()).toContain("revoked");broker.connectAccountBot(next,"bot");
 expect(broker.poll(next,"device").operations).toEqual([]);
 expect(()=>broker.dispatch({method:"environment",botId:"bot",runId:"old-run"},context())).toThrow("previous project");
 expect(broker.poll(owner,"device").bindings).toEqual([]);
});

it("keeps two desktop instances present and routes each Mico to the computer that connected it", async () => {
  let now = 0;
  broker = new DesktopRelayBroker(() => now);
  const prod = owner;
  const dev = { ...owner, sessionId: "dev-session" };
  broker.register(prod, { deviceId: "prod-pc", generation: "prod-gen", agentExecution: 1 });
  broker.connectAccountBot(prod, "bot");
  const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
  const delivered = broker.poll(prod, "prod-pc");
  expect(delivered.operations).toHaveLength(1);
  broker.register(dev, { deviceId: "dev-pc", generation: "dev-gen", agentExecution: 1 });
  broker.bind(dev, { deviceId: "dev-pc", generation: "dev-gen", botId: "other" });
  expect(broker.agentAvailable(prod, "bot")).toBe(true);
  expect(broker.poll(prod, "prod-pc").active).toEqual([delivered.operations[0]!.id]);
  expect(broker.poll(prod, "prod-pc").bindings?.map(item => item.botId)).toEqual(["bot"]);
  expect(broker.poll(dev, "dev-pc").bindings?.map(item => item.botId)).toEqual(["other"]);
  expect(broker.poll(dev, "dev-pc").operations).toEqual([]);
  now = 60_000;
  broker.register(prod, { deviceId: "prod-pc", generation: "prod-gen", agentExecution: 1 });
  broker.poll(prod, "prod-pc");
  now = 100_000;
  expect(broker.agentAvailable(prod, "bot")).toBe(true);
  expect(broker.available(dev, "other")).toBe(false);
  expect(broker.hasAgentDevice(prod)).toBe(true);
  broker.register(dev, { deviceId: "dev-pc", generation: "dev-gen", agentExecution: 1 });
  broker.bind(dev, { deviceId: "dev-pc", generation: "dev-gen", botId: "other" });
  broker.revoke(dev, "dev-pc");
  expect(broker.hasAgentDevice(prod)).toBe(true);
  expect(broker.agentAvailable(prod, "bot")).toBe(true);
  expect(broker.poll(prod, "prod-pc").active).toEqual([delivered.operations[0]!.id]);
  expect(broker.available(dev, "other")).toBe(false);
  broker.result(prod, "prod-pc", delivered.operations[0]!.id, 0, Buffer.from('{"done":true}\n').toString("base64"), true);
  expect(await response.text()).toContain("done");
});

it("moves an idle Mico to the desktop that just connected and leaves the other desktop online", () => {
  broker = new DesktopRelayBroker();
  const prod = owner;
  const dev = { ...owner, sessionId: "dev-session" };
  broker.register(prod, { deviceId: "prod-pc", generation: "prod-gen", agentExecution: 1 });
  broker.connectAccountBot(prod, "bot");
  broker.register(dev, { deviceId: "dev-pc", generation: "dev-gen", agentExecution: 1 });
  broker.bind(dev, { deviceId: "dev-pc", generation: "dev-gen", botId: "bot" });
  expect(broker.poll(dev, "dev-pc").bindings?.map(item => item.botId)).toEqual(["bot"]);
  expect(broker.poll(prod, "prod-pc").bindings).toEqual([]);
  expect(broker.hasAgentDevice(prod)).toBe(true);
  broker.bind(prod, { deviceId: "prod-pc", generation: "prod-gen", botId: "bot" });
  expect(broker.poll(prod, "prod-pc").bindings?.map(item => item.botId)).toEqual(["bot"]);
  expect(broker.poll(dev, "dev-pc").bindings).toEqual([]);
  expect(broker.hasAgentDevice(dev)).toBe(true);
});

it("does not drop a polling desktop when another session reuses its device id", async () => {
  broker = new DesktopRelayBroker();
  broker.register(owner, { ...binding, agentExecution: 1 });
  broker.connectAccountBot(owner, "bot");
  const controller = new AbortController();
  const waiting = broker.waitPoll(owner, "device", controller.signal, true, []);
  const other = { ...owner, sessionId: "dev-session" };
  broker.register(other, { ...binding, generation: "dev-generation" });
  expect(broker.ownedBindings(owner, "device")).toEqual(["bot"]);
  expect(broker.agentAvailable(owner, "bot")).toBe(true);
  expect(broker.ownedBindings(other, "device")).toEqual([]);
  controller.abort();
  await waiting;
});

it("queues eight parallel calls, admits only two per agent and never reclaims delivered work", async () => {
  broker = new DesktopRelayBroker(); broker.bind(owner, binding);
  const responses = Array.from({length:8}, (_,i) => broker.dispatch({method:"execute",botId:"bot",command:{argv:["read-only",String(i)]}},context()));
  expect(() => broker.dispatch({method:"environment",botId:"bot"},context())).toThrow("queue is full");
  expect(broker.available(owner,"bot")).toBe(true);
  const seen = new Set<string>();
  for (let wave=0;wave<4;wave++) {
    const state=broker.poll(owner,"device");
    expect(state.operations).toHaveLength(2);expect(state.active).toHaveLength(2);
    expect(broker.poll(owner,"device").operations).toEqual([]);
    for(const op of state.operations){expect(seen.has(op.id)).toBe(false);seen.add(op.id);broker.result(owner,"device",op.id,0,Buffer.from('{"done":true}\n').toString("base64"),true);}
  }
  expect(seen.size).toBe(8);expect(broker.poll(owner,"device").active).toEqual([]);
  expect(await Promise.all(responses.map(r=>r.text()))).toEqual(Array(8).fill('{"done":true}\n'));
});

it("removes a cancelled queued call without ever delivering it to the PC",async()=>{
  broker=new DesktopRelayBroker();broker.bind(owner,binding);
  const first=broker.dispatch({method:"environment",botId:"bot"},context());
  const second=broker.dispatch({method:"environment",botId:"bot"},context());
  const controller=new AbortController();const cancelled=broker.dispatch({method:"execute",botId:"bot",command:{argv:["must-not-run"]}},{...context(),signal:controller.signal});
  const state=broker.poll(owner,"device");expect(state.operations).toHaveLength(2);
  controller.abort();expect(await cancelled.text()).toContain("cancelled");
  for(const op of state.operations)broker.result(owner,"device",op.id,0,"",true);
  await Promise.all([first.text(),second.text()]);expect(broker.poll(owner,"device").operations).toEqual([]);
});

it("retains the global eight-operation execution limit across queued agents",async()=>{
  broker=new DesktopRelayBroker();const responses:Response[]=[];
  for(let bot=0;bot<5;bot++){
    broker.bind(owner,{...binding,botId:"bot-"+bot});
    for(let i=0;i<3;i++)responses.push(broker.dispatch({method:"environment",botId:"bot-"+bot},context()));
  }
  let completed=0;
  while(completed<15){
    const state=broker.poll(owner,"device");expect(state.active.length).toBeLessThanOrEqual(8);expect(state.operations.length).toBeGreaterThan(0);
    const counts=new Map<string,number>();for(const op of state.operations){counts.set(op.binding.botId,(counts.get(op.binding.botId)??0)+1);broker.result(owner,"device",op.id,0,"",true);completed++;}
    expect([...counts.values()].every(n=>n<=2)).toBe(true);
  }
  await Promise.all(responses.map(r=>r.text()));
});

it("reserves callback and command lanes while two tasks of the same Mico own native runtime slots",async()=>{
  broker=new DesktopRelayBroker();broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
  const responses:Response[]=[];
  for(let n=0;n<2;n++)responses.push(broker.dispatch({method:"agentRun",botId:"bot",runId:`run-${n}`,sessionId:crypto.randomUUID(),request:{}},context()));
  expect(broker.poll(owner,"device").operations).toHaveLength(2);
  responses.push(broker.dispatch({method:"agentMessage",botId:"bot",runId:"run-0",sessionId:crypto.randomUUID(),message:{}},context()));
  responses.push(broker.dispatch({method:"execute",botId:"bot",command:{argv:["fixture"]}},context()));
  const next=broker.poll(owner,"device");
  expect(next.operations.map(op=>(op.request as {method:string}).method).sort()).toEqual(["agentMessage","execute"]);
  broker.close();await Promise.all(responses.map(r=>r.text()));
});

it("does not drop a finished command when the account lease lapses under a live heartbeat", () => {
  let now = 0;
  broker = new DesktopRelayBroker(() => now);
  broker.register(owner, { ...binding, agentExecution: 1 });
  broker.connectAccountBot(owner, "bot");
  const sessionId = crypto.randomUUID();
  const run = broker.dispatch({ method: "agentRun", botId: "bot", runId: "run", sessionId, request: {} }, context());
  expect(broker.poll(owner, "device").operations).toHaveLength(1);
  now = 30_000;
  expect(broker.poll(owner, "device").active).toEqual([expect.any(String)]);
  now = 70_000;
  expect(broker.agentAvailable(owner, "bot")).toBe(true);
  broker.register(owner, binding);
  expect(broker.agentAvailable(owner, "bot")).toBe(true);
  const callback = broker.dispatch({ method: "agentMessage", botId: "bot", runId: "run", sessionId, message: { kind: "result" } }, context());
  expect(callback.ok).toBe(true);
  broker.close();
  void run.body?.cancel();
  void callback.body?.cancel();
});

it("does not route an agent engine to old clients or another owner's device",()=>{
  broker=new DesktopRelayBroker();broker.register(owner,binding);broker.connectAccountBot(owner,"bot");
  expect(broker.agentAvailable(owner,"bot")).toBe(false);
  expect(()=>broker.dispatch({method:"agentRun",botId:"bot",runId:"run",sessionId:crypto.randomUUID(),request:{}},context())).toThrow("unavailable");
  broker.register(owner,{...binding,agentExecution:1});
  expect(broker.agentAvailable(owner,"bot")).toBe(true);
  expect(broker.agentAvailable({...owner,userId:"other"},"bot")).toBe(false);
});

it("wakes a native long poll on dispatch and cancellation without busy polling or replay",async()=>{
  broker=new DesktopRelayBroker();broker.bind(owner,binding);
  const controller=new AbortController();
  const waiting=broker.waitPoll(owner,"device",controller.signal,true,[]);
  const command=broker.dispatch({method:"environment",botId:"bot"},context());
  const state=await waiting;expect(state.operations).toHaveLength(1);
  expect(broker.poll(owner,"device").operations).toEqual([]);
  const next=broker.waitPoll(owner,"device",controller.signal,true,state.active);
  broker.result(owner,"device",state.operations[0]!.id,0,"",true);
  expect((await next).active).toEqual([]);await command.text();
  const stopped=broker.waitPoll(owner,"device",controller.signal,true,[]);controller.abort();await stopped;
});

it("leaves a callback available if the poll drops during reauthentication", async () => {
  broker = new DesktopRelayBroker(); broker.bind(owner, binding);
  const command = broker.dispatch({ method: "environment", botId: "bot" }, context());
  const controller = new AbortController();
  const dropped = await broker.waitPoll(owner, "device", controller.signal, true, [], async () => {
    await expect(broker.waitPoll(owner, "device", controller.signal)).rejects.toThrow("already pending");
    controller.abort();
  });
  expect(dropped.operations).toEqual([]);
  const next = await broker.waitPoll(owner, "device", new AbortController().signal);
  expect(next.operations).toHaveLength(1);
  await command.body?.cancel();
});

it("fences a second agent start even when later callbacks share the same run",async()=>{
 broker=new DesktopRelayBroker();broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
 const run={method:"agentRun" as const,botId:"bot",runId:"one-run",sessionId:crypto.randomUUID(),request:{}};
 const first=broker.dispatch(run,context());
 const callback=broker.dispatch({method:"agentMessage",botId:"bot",runId:run.runId,sessionId:run.sessionId,message:{}},context());
 expect(()=>broker.dispatch({...run,sessionId:crypto.randomUUID()},context())).toThrow("already dispatched");
 broker.close();await Promise.all([first.text(),callback.text()]);
});

it("admits an approval continuation once, without admitting simultaneous or repeated segments", async () => {
  broker = new DesktopRelayBroker(); broker.register(owner, { ...binding, agentExecution: 1 }); broker.connectAccountBot(owner, "bot");
  const run = { method: "agentRun" as const, botId: "bot", runId: "approval-run", sessionId: crypto.randomUUID(), request: {} };
  const first = broker.dispatch(run, context());
  const resumed = { ...run, segmentId: "a".repeat(64), sessionId: crypto.randomUUID() };
  expect(() => broker.dispatch(resumed, context())).toThrow();
  const [operation] = broker.poll(owner, "device").operations;
  broker.result(owner, "device", operation!.id, 0, Buffer.from('{"done":true}\n').toString("base64"), true);
  await first.text();
  const next = broker.dispatch(resumed, context());
  expect(broker.poll(owner, "device").operations[0]?.request).toMatchObject({ runId: run.runId, segmentId: resumed.segmentId });
  expect(() => broker.dispatch({ ...resumed, sessionId: crypto.randomUUID() }, context())).toThrow("already dispatched");
  expect(() => broker.dispatch({ ...run, sessionId: crypto.randomUUID() }, context())).toThrow("already dispatched");
  broker.close(); await next.text();
});

it("ends a quitting PC's presence at once without revoking it, and lets an unreceived start run again",async()=>{
  broker=new DesktopRelayBroker();broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
  const run={method:"agentRun" as const,botId:"bot",runId:"quit-run",sessionId:crypto.randomUUID(),request:{}};
  const unreceived=broker.dispatch(run,context());
  broker.release({...owner,sessionId:"other"},"device");
  expect(broker.agentAvailable(owner,"bot")).toBe(true);
  broker.release(owner,"device");
  expect(broker.agentAvailable(owner,"bot")).toBe(false);
  expect(broker.hasAgentDevice(owner)).toBe(false);
  expect(JSON.parse(await unreceived.text())).toMatchObject({code:"desktop_disconnected",dispatched:false});
  // Reconnecting with the same restored generation admits the same start once.
  broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
  const again=broker.dispatch({...run,sessionId:crypto.randomUUID()},context());
  expect(broker.poll(owner,"device").operations[0]?.request).toMatchObject({runId:run.runId});
  expect(()=>broker.dispatch({...run,sessionId:crypto.randomUUID()},context())).toThrow("already dispatched");
  broker.close();await again.text();
});

it("never lets a start the PC already received run again after it disconnects",async()=>{
  broker=new DesktopRelayBroker();broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
  const run={method:"agentRun" as const,botId:"bot",runId:"received-run",sessionId:crypto.randomUUID(),request:{}};
  const received=broker.dispatch(run,context());
  expect(broker.poll(owner,"device").operations).toHaveLength(1);
  broker.release(owner,"device");
  expect(JSON.parse(await received.text())).toMatchObject({code:"desktop_disconnected",dispatched:true});
  broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
  expect(()=>broker.dispatch({...run,sessionId:crypto.randomUUID()},context())).toThrow("already dispatched");
});

it("hands its PCs to a new server version and still answers the runs already open here", async () => {
  let now = 1_000;
  broker = new DesktopRelayBroker(() => now);
  broker.register(owner, { ...binding, agentExecution: 1 }); broker.connectAccountBot(owner, "bot");
  const run = broker.dispatch({ method: "agentRun", botId: "bot", runId: "open-run", sessionId: crypto.randomUUID(), request: {} }, context());
  const runOp = broker.poll(owner, "device").operations[0]!.id;
  broker.handOff(true);
  expect(broker.handoffState()).toEqual({
    handingOff: true, handoffEndsAt: new Date(now + DESKTOP_RELAY_HANDOFF_MS).toISOString(),
    openOperations: 1, deliveredOperations: 1, agentRuns: 1, connectedComputers: 1,
  });
  const refusal = (request: Parameters<DesktopRelayBroker["dispatch"]>[0]) => {
    try { broker.dispatch(request, context()); } catch (error) { return error; }
    return undefined;
  };
  // New work never reaches the PC through this instance: it waits for the new version.
  for (const request of [
    { method: "execute" as const, botId: "bot", command: { argv: ["fixture"] } },
    { method: "agentRun" as const, botId: "bot", runId: "new-run", sessionId: crypto.randomUUID(), request: {} },
    { method: "agentMessage" as const, botId: "bot", runId: "other-run", sessionId: crypto.randomUUID(), message: {} },
  ]) expect(refusal(request)).toMatchObject({ code: "desktop_updating", status: 503 });
  // The open run's callbacks still pass, so it finishes where it started.
  const callback = broker.dispatch({ method: "agentMessage", botId: "bot", runId: "open-run", sessionId: crypto.randomUUID(), message: {} }, context());
  const callbackOp = broker.poll(owner, "device").operations[0]!.id;
  const done = Buffer.from('{"done":true}\n').toString("base64");
  broker.result(owner, "device", callbackOp, 0, done, true);
  broker.result(owner, "device", runOp, 0, done, true);
  await Promise.all([run.text(), callback.text()]);
  expect(broker.handoffState()).toMatchObject({ handingOff: true, openOperations: 0, agentRuns: 0 });
  // A rollback ends it at once; a handoff nobody renews ends by itself.
  broker.handOff(false);
  expect(broker.handoffState()).not.toHaveProperty("handoffEndsAt");
  await broker.dispatch({ method: "environment", botId: "bot" }, { ...context(), signal: AbortSignal.abort() }).text();
  broker.handOff(true);
  now += DESKTOP_RELAY_HANDOFF_MS - 1;
  expect(broker.handingOff()).toBe(true);
  now += 1;
  expect(broker.handingOff()).toBe(false);
  expect(broker.handoffState()).toMatchObject({ handingOff: false });
});

describe("Desktop availability checks", () => {
  const key = desktopRelayKey("fixture-relay-secret");
  const servers: Server[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const server of servers.splice(0)) await new Promise((done) => server.close(done));
  });
  /** A relay that answers every probe with this status and body. */
  async function relay(status: number, body: unknown) {
    const server = createServer((request, response) => {
      request.resume().on("end", () => {
        response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      });
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/desktop-relay/internal`;
  }

  it("takes availability only from the relay's own answer", async () => {
    await expect(desktopRelayAvailable(await relay(200, { available: true }), key)(context())).resolves.toBe(true);
    await expect(desktopRelayAvailable(await relay(404, { available: false }), key)(context())).resolves.toBe(false);
    await expect(desktopAgentSelection(await relay(200, { agentExecution: 1, available: false, preferred: true }), key)(context()))
      .resolves.toEqual({ available: false, preferred: true });
  });

  it.each([409, 429, 503])("never reads a busy relay (%i) as an offline PC", async (status) => {
    const url = await relay(status, { error: "busy" });
    await expect(desktopRelayAvailable(url, key)(context())).rejects.toBeInstanceOf(DesktopUnreachableError);
    await expect(desktopAgentSelection(url, key)(context())).rejects.toBeInstanceOf(DesktopUnreachableError);
  });

  it("waits for a relay handing its PCs to a new server version, never reading it as offline", async () => {
    const handingOff = () => new Response(JSON.stringify({ error: "moving" }), {
      status: 503, headers: { "content-type": "application/json", "x-mycellios-desktop-error": "desktop_updating" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(handingOff()).mockResolvedValueOnce(handingOff()));
    const presence = await desktopRelayAvailable("http://relay.invalid/internal", key)(context()).catch((error: unknown) => error);
    expect(presence).toBeInstanceOf(ComputerUpdatingError);
    expect(presence).toMatchObject({ dispatched: false });
    await expect(desktopAgentSelection("http://relay.invalid/internal", key)(context()))
      .rejects.toBeInstanceOf(ComputerUpdatingError);
  });

  it("reports a timed-out or lost check as no answer, not as offline", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(timeout).mockRejectedValueOnce(new TypeError("fetch failed")));
    const timedOut = await desktopRelayAvailable("http://relay.invalid/internal", key)(context()).catch((error: unknown) => error);
    expect(timedOut).toBeInstanceOf(DesktopUnreachableError);
    expect((timedOut as Error).cause).toBe(timeout);
    await expect(desktopAgentSelection("http://relay.invalid/internal", key)(context()))
      .rejects.toBeInstanceOf(DesktopUnreachableError);
  });

  it("keeps the caller's own cancellation a cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const url = await relay(200, { available: true });
    const cancelled = await desktopAgentSelection(url, key)({ ...context(), signal: controller.signal })
      .catch((error: unknown) => error);
    expect(cancelled).not.toBeInstanceOf(DesktopUnreachableError);
    expect(cancelled).toMatchObject({ name: "AbortError" });
  });
});

const folder = (botId: string) => createHash("sha256").update(botId).digest("hex");

it("routes each Mico to the one online PC that holds its folder and never guesses the rest", () => {
  broker = new DesktopRelayBroker();
  const mac = { ...owner, sessionId: "mac-session" };
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", agentExecution: 1, workspaces: [folder("writer"), folder("shared")] });
  broker.register(mac, { deviceId: "mac-pc", generation: "mac-gen", agentExecution: 1, workspaces: [folder("planner"), folder("shared")] });
  for (const bot of ["writer", "planner", "shared", "never-ran"]) broker.connectAccountBot(owner, bot);
  expect(broker.poll(owner, "windows-pc").bindings?.map(item => item.botId)).toEqual(["writer"]);
  expect(broker.poll(mac, "mac-pc").bindings?.map(item => item.botId)).toEqual(["planner"]);
  expect(broker.agentAvailable(owner, "writer")).toBe(true);
  expect(broker.agentAvailable(owner, "planner")).toBe(true);
  for (const bot of ["shared", "never-ran"]) {
    expect(broker.available(owner, bot)).toBe(false);
    expect(broker.unresolved(owner, bot)).toBe(true);
  }
  expect(broker.unresolved(owner, "writer")).toBe(false);
  expect(broker.unresolved({ ...owner, userId: "other" }, "shared")).toBe(false);
  // Sending from Desktop binds explicitly, which settles the choice on that PC.
  broker.bind(mac, { deviceId: "mac-pc", generation: "mac-gen", botId: "shared" });
  expect(broker.agentAvailable(owner, "shared")).toBe(true);
  expect(broker.unresolved(owner, "shared")).toBe(false);
  // A PC that reports a Mico later does not take it from the PC already running it.
  broker.register(mac, { deviceId: "mac-pc", generation: "mac-gen", agentExecution: 1, workspaces: [folder("planner"), folder("shared"), folder("writer")] });
  broker.connectAccountBot(owner, "writer");
  expect(broker.ownedBindings(owner, "windows-pc")).toEqual(["writer"]);
});

it("gives a Mico to the online PC its owner chose and reports only new choices", () => {
  broker = new DesktopRelayBroker();
  const mac = { ...owner, sessionId: "mac-session" };
  const pcs = () => {
    broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", agentExecution: 1, workspaces: [folder("shared")] });
    broker.register(mac, { deviceId: "mac-pc", generation: "mac-gen", agentExecution: 1, workspaces: [folder("shared")] });
  };
  pcs();
  expect(broker.needsChoice(owner, "shared")).toBe(true);
  // An explicit bind is a new choice; the same PC reasserting it is not.
  expect(broker.bind(mac, { deviceId: "mac-pc", generation: "mac-gen", botId: "shared" })).toBe(true);
  expect(broker.bind(mac, { deviceId: "mac-pc", generation: "mac-gen", botId: "shared" })).toBe(false);
  expect(broker.needsChoice(owner, "shared")).toBe(false);
  expect(broker.bind(owner, { deviceId: "windows-pc", generation: "windows-gen", botId: "shared" })).toBe(true);

  // After a restart only the remembered key settles it; a raw id or an offline PC never does.
  broker.close();
  broker = new DesktopRelayBroker();
  pcs();
  broker.connectAccountBot(owner, "shared", "mac-pc");
  broker.connectAccountBot(owner, "shared", desktopDeviceKey("gone-pc"));
  expect(broker.unresolved(owner, "shared")).toBe(true);
  broker.connectAccountBot(owner, "shared", desktopDeviceKey("mac-pc"));
  expect(broker.ownedBindings(mac, "mac-pc")).toEqual(["shared"]);
  expect(broker.agentAvailable(owner, "shared")).toBe(true);
  expect(broker.needsChoice(owner, "shared")).toBe(false);

  // One online PC still takes every Mico without a lookup.
  broker.close();
  broker = new DesktopRelayBroker();
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", agentExecution: 1 });
  expect(broker.needsChoice(owner, "shared")).toBe(false);
  broker.connectAccountBot(owner, "shared", desktopDeviceKey("mac-pc"));
  expect(broker.ownedBindings(owner, "windows-pc")).toEqual(["shared"]);
});

it("keeps one online PC taking every Mico and leaves older Desktops unresolved, not offline", () => {
  let now = 0;
  broker = new DesktopRelayBroker(() => now);
  const mac = { ...owner, sessionId: "mac-session" };
  // Desktop 0.16/0.17 sends no folder report.
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", agentExecution: 1 });
  broker.register(mac, { deviceId: "mac-pc", generation: "mac-gen", agentExecution: 1 });
  broker.connectAccountBot(owner, "bot");
  expect(broker.available(owner, "bot")).toBe(false);
  expect(broker.unresolved(owner, "bot")).toBe(true);
  now = 60_000;
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", agentExecution: 1, workspaces: [] });
  now = 100_000; // The Mac stopped polling and its presence lapsed.
  expect(broker.unresolved(owner, "bot")).toBe(true);
  broker.connectAccountBot(owner, "bot");
  expect(broker.agentAvailable(owner, "bot")).toBe(true);
  now = 200_000; // No PC left: offline, which is not unresolved.
  expect(broker.available(owner, "bot")).toBe(false);
  expect(broker.unresolved(owner, "bot")).toBe(false);
});

it("keeps a PC's folder report across registrations that omit it, but not across a new generation", () => {
  broker = new DesktopRelayBroker();
  const mac = { ...owner, sessionId: "mac-session" };
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen", workspaces: [folder("bot")] });
  broker.register(owner, { deviceId: "windows-pc", generation: "windows-gen" });
  broker.register(mac, { deviceId: "mac-pc", generation: "mac-gen" });
  broker.connectAccountBot(owner, "bot");
  expect(broker.ownedBindings(owner, "windows-pc")).toEqual(["bot"]);
  broker.revokeBot(owner, "bot");
  broker.register(owner, { deviceId: "windows-pc", generation: "restarted-gen" });
  broker.connectAccountBot(owner, "bot");
  expect(broker.unresolved(owner, "bot")).toBe(true);
});

it("reads an unresolved Mico as an online PC, and an older API as before", async () => {
  const replies: unknown[] = [{ available: true }, { available: false, unresolved: true }, { available: false }];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(replies.shift()));
  try {
    const presence = desktopRelayPresence("https://relay.invalid/api/desktop-relay/internal", "relay-key");
    expect(await presence(context())).toBe("connected");
    expect(await presence(context())).toBe("unresolved");
    expect(await presence(context())).toBe("offline");
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await presence(context())).toBe("offline");
    expect(await presence({ ...context(), botId: undefined })).toBe("offline");
    const select = desktopAgentSelection("https://relay.invalid/api/desktop-relay/internal", "relay-key");
    fetch.mockResolvedValueOnce(Response.json({ agentExecution: 1, available: false, preferred: true, unresolved: true }));
    expect(await select(context())).toEqual({ available: false, preferred: true, unresolved: true });
    fetch.mockResolvedValueOnce(Response.json({ agentExecution: 1, available: false, preferred: true }));
    expect(await select(context())).toEqual({ available: false, preferred: true });
  } finally { fetch.mockRestore(); }
});

describe("agent channel", () => {
  const lines = async (reader: ReadableStreamDefaultReader<Uint8Array>, count: number) => {
    const out: Array<Record<string, unknown>> = [];
    let text = "";
    while (out.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      let end: number;
      while ((end = text.indexOf("\n")) >= 0) {
        const line = JSON.parse(text.slice(0, end)) as Record<string, unknown>;
        text = text.slice(end + 1);
        if (line.keepalive !== 1) out.push(line);
      }
    }
    return out;
  };
  const agentPc = () => {
    broker = new DesktopRelayBroker();
    broker.register(owner, { ...binding, agentExecution: 1 });
    broker.connectAccountBot(owner, "bot");
    const run = broker.dispatch({ method: "agentRun", botId: "bot", runId: "run", sessionId: crypto.randomUUID(), request: {} }, context());
    expect(broker.poll(owner, "device").operations).toHaveLength(1);
    return run;
  };
  const message = () => broker.dispatch({ method: "agentMessage", botId: "bot", runId: "run", sessionId: crypto.randomUUID(), message: { kind: "result" } }, context());

  it("delivers agent messages on the channel, never through a poll, and acknowledges them by result", async () => {
    const run = agentPc();
    const reader = broker.attachChannel(owner, "device", new AbortController().signal).getReader();
    const callback = message();
    const [delivered] = await lines(reader, 1);
    expect(delivered).toMatchObject({ binding: { deviceId: "device", botId: "bot", generation: "generation" }, request: { method: "agentMessage" } });
    const polled = broker.poll(owner, "device");
    expect(polled.operations).toEqual([]);
    expect(polled.active).not.toContain(delivered!.id);
    broker.result(owner, "device", delivered!.id as string, 0, Buffer.from('{"ok":true}\n').toString("base64"), true);
    expect(await callback.text()).toBe('{"ok":true}\n');
    await reader.cancel(); void run.body?.cancel();
  });

  it("returns what the PC did not acknowledge to the poll when the channel ends", async () => {
    const run = agentPc();
    const reader = broker.attachChannel(owner, "device", new AbortController().signal).getReader();
    const callback = message();
    const [delivered] = await lines(reader, 1);
    await reader.cancel();
    expect(broker.poll(owner, "device").operations.map(op => op.id)).toEqual([delivered!.id]);
    broker.result(owner, "device", delivered!.id as string, 0, Buffer.from('{"ok":true}\n').toString("base64"), true);
    expect(await callback.text()).toBe('{"ok":true}\n');
    void run.body?.cancel();
  });

  it("does not count channel messages against the shared poll limit", async () => {
    const run = agentPc();
    const reader = broker.attachChannel(owner, "device", new AbortController().signal).getReader();
    const callbacks = [message(), message(), message(), message()];
    const delivered = await lines(reader, 4);
    expect(delivered).toHaveLength(4);
    for (const line of delivered) broker.result(owner, "device", line.id as string, 0, "", true);
    await Promise.all(callbacks.map(response => response.text()));
    await reader.cancel(); void run.body?.cancel();
  });

  it("refuses a channel for a PC that is not connected and closes it on revoke", async () => {
    broker = new DesktopRelayBroker();
    expect(() => broker.attachChannel(owner, "device", new AbortController().signal)).toThrow("Desktop device is not connected");
    broker.register(owner, { ...binding, agentExecution: 1 });
    const reader = broker.attachChannel(owner, "device", new AbortController().signal).getReader();
    expect((await reader.read()).value).toBeDefined(); // the opening keepalive
    broker.revoke(owner, "device");
    expect((await reader.read()).done).toBe(true);
  });

  it("leaves messages to the poll when the PC has no channel", async () => {
    const run = agentPc();
    const callback = message();
    expect(broker.poll(owner, "device").operations.map(op => (op.request as { method: string }).method)).toEqual(["agentMessage"]);
    broker.close(); await callback.text(); void run.body?.cancel();
  });
});
