import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunRequest, AgentRuntime } from "@rakazo/adapter-kit";
import { afterEach, expect, it, vi } from "vitest";
import { createDesktopAgentEngine } from "./desktop-agent-engine.js";

const roots: string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const input:AgentRunRequest={botId:"mico",threadId:"thread",runId:"same-run",prompt:"private-prompt",instructions:"private-instructions",history:[],tools:[],model:{provider:"fixture",id:"fixture"}};
const fixture=():AgentRuntime=>({describe:()=>({id:"fixture",contractVersion:"1",adapterVersion:"1",capabilities:{streaming:true,tools:true,compaction:true,scripted:true}}),abort:vi.fn(),async *run(){yield{type:"done"};}});
it("isolates account/server scopes and rejects replay across engine and process recreation",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"mc-engine-test-"));roots.push(root);
 let scope:string|undefined="a".repeat(64);const start=vi.fn(()=>fixture());
 let engine=createDesktopAgentEngine(root,()=>scope,start);
 for await(const _ of engine.run(input)){}
 engine=createDesktopAgentEngine(root,()=>scope,start);
 await expect(async()=>{for await(const _ of engine.run(input)){};}).rejects.toThrow("already finished on your PC");
 expect(start).toHaveBeenCalledTimes(1);
 const receiptDir=path.join(root,"agent-executor",scope,"receipts");
 const receipt=await readFile(path.join(receiptDir,(await readdir(receiptDir))[0]!),"utf8");
 expect(receipt).not.toContain("private-");expect(JSON.parse(receipt).state).toBe("completed");
 scope="b".repeat(64);for await(const _ of engine.run(input)){};expect(start).toHaveBeenCalledTimes(2);
 scope=undefined;await expect(async()=>{for await(const _ of engine.run({...input,runId:"new"})){};}).rejects.toThrow("unavailable");
 expect(start).toHaveBeenCalledTimes(2);
});
it("reports an interrupted local run instead of asking the user to audit it",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"mc-engine-test-"));roots.push(root);
 const scope="c".repeat(64);
 const start=vi.fn(():AgentRuntime=>({describe:()=>({id:"fixture",contractVersion:"1",adapterVersion:"1",capabilities:{streaming:true,tools:true,compaction:true,scripted:true}}),abort:vi.fn(),async *run(){throw new Error("provider dropped");}}));
 const engine=createDesktopAgentEngine(root,()=>scope,start);
 await expect(async()=>{for await(const _ of engine.run(input)){};}).rejects.toThrow("provider dropped");
 await expect(async()=>{for await(const _ of engine.run(input)){};}).rejects.toThrow("interrupted on your PC. Send a new message");
 expect(start).toHaveBeenCalledTimes(1);
});

it("continues a saved approval checkpoint once while preserving the parent run identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mc-engine-resume-")); roots.push(root);
  const scope = "d".repeat(64), starts: string[] = [];
  const start = vi.fn((): AgentRuntime => ({ ...fixture(), async *run(request) {
    starts.push(request.runId); yield { type: "done" };
  } }));
  let engine = createDesktopAgentEngine(root, () => scope, start);
  for await (const _ of engine.run(input)) {}
  const resumed = { ...input, turnCheckpoint: "server-owned-approval-checkpoint" };
  for await (const _ of engine.run(resumed)) {}
  expect(start).toHaveBeenCalledTimes(2);
  expect(new Set(starts).size).toBe(1);
  engine = createDesktopAgentEngine(root, () => scope, start);
  await expect(async () => { for await (const _ of engine.run(resumed)) {} }).rejects.toThrow("already finished");
  await expect(async () => { for await (const _ of engine.run(input)) {} }).rejects.toThrow("already finished");
  expect(start).toHaveBeenCalledTimes(2);
});
