import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
vi.mock("@earendil-works/pi-agent-core",()=>({ Agent:class {
 state={errorMessage:undefined,messages:[] as unknown[]}; subscribe(){return ()=>{};}
 async prompt(){this.state.messages=[{role:"assistant",content:[{type:"text",text:"Temporary answer"}]}];} async waitForIdle(){} abort(){}
} }));
vi.mock("@earendil-works/pi-ai/providers/all",()=>({builtinModels:()=>({getModel:()=>({provider:"test",id:"test",contextWindow:32768,maxTokens:4096,reasoning:false}),streamSimple:()=>{throw new Error("No real inference in this test");}})}));
vi.mock("./pi-local-provider.js",()=>({registerLocalProvider:(models:unknown)=>models}));
vi.mock("./pi-openai-compatible-provider.js",()=>({OPENAI_COMPATIBLE_PROVIDER_ID:"openai-compatible",registerOpenAiCompatibleCatalog:(models:unknown)=>models,registerOpenAiCompatibleRuntime:(models:unknown)=>models}));
import { PiAgentRuntime } from "./pi-runtime.js";
it("keeps normal session recording but never stores a temporary side question",async()=>{
 const root=await mkdtemp(join(tmpdir(),"mycellios-ephemeral-"));
 try {
  const runtime=new PiAgentRuntime({sessionRoot:root});
  const run=async(ephemeral:boolean)=>{for await(const _event of runtime.run({botId:"bot",threadId:ephemeral?"aside:one":"main",runId:ephemeral?"aside:one":"normal",instructions:"Be concise",prompt:"Synthetic question",history:[],tools:[],model:{provider:"test",id:"test"},ephemeral,allowSilentEmpty:true},{spaceId:"space",userId:"user"})){/* consume */}};
  await run(true);expect(await readdir(root,{recursive:true})).toEqual([]);
  await run(false);expect((await readdir(root,{recursive:true})).some(file=>file.endsWith(".jsonl"))).toBe(true);
 } finally {await rm(root,{recursive:true,force:true});}
});
