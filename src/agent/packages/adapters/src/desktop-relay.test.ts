import { afterEach, describe, expect, it } from "vitest";
import { DesktopRelayBroker, desktopRelayKey, signDesktopRelay, verifyDesktopRelay } from "./desktop-relay.js";
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
  it("expires disconnected work and never moves an active agent to a different PC", async () => {
    let now = 0; broker = new DesktopRelayBroker(() => now); broker.bind(owner, binding);
    expect(() => broker.bind(owner, { ...binding, deviceId: "other" })).toThrow();
    const response = broker.dispatch({ method: "environment", botId: "bot" }, context());
    now = 46_000;
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
 expect(()=>broker.register(owner,{...binding,deviceId:"different-pc"})).toThrow();
 now+=46000;expect(broker.available(owner,"unopened")).toBe(false);
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

it("fences a second agent start even when later callbacks share the same run",async()=>{
 broker=new DesktopRelayBroker();broker.register(owner,{...binding,agentExecution:1});broker.connectAccountBot(owner,"bot");
 const run={method:"agentRun" as const,botId:"bot",runId:"one-run",sessionId:crypto.randomUUID(),request:{}};
 const first=broker.dispatch(run,context());
 const callback=broker.dispatch({method:"agentMessage",botId:"bot",runId:run.runId,sessionId:run.sessionId,message:{}},context());
 expect(()=>broker.dispatch({...run,sessionId:crypto.randomUUID()},context())).toThrow("already dispatched");
 broker.close();await Promise.all([first.text(),callback.text()]);
});
