import {describe,expect,it} from "vitest";
import {readManagedTextStream} from "../src/coordinator/managed-text-stream.js";

const prelude={id:"gateway-envelope",choices:[{index:0,delta:{role:"assistant",content:"",reasoning_content:null,tool_calls:null},finish_reason:null}]};
const payload={id:"vendor-answer",choices:[{index:0,delta:{content:"Hello"},finish_reason:null}]};
const finished={id:"vendor-answer",choices:[{index:0,delta:{},finish_reason:"stop"}]};
const usage={id:"gateway-envelope",choices:[],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}};
const response=(rows:unknown[],terminal=true)=>new Response(rows.map(r=>"data: "+JSON.stringify(r)+"\n\n").join("")+(terminal?"data: [DONE]\n\n":""));
const read=(rows:unknown[],legacy=true,terminal=true)=>readManagedTextStream(response(rows,terminal),AbortSignal.timeout(2000),JSON.parse,"public-model",undefined,legacy);

describe("AntSeed paired SSE envelope compatibility (no upstream calls)",()=>{
 it("retains one vendor identity and complete usage under a distinct paired envelope",async()=>{
  const chunks:Record<string,unknown>[]=[];
  const r=await readManagedTextStream(response([prelude,payload,finished,usage]),AbortSignal.timeout(2000),JSON.parse,"public-model",v=>chunks.push(v),true);
  expect(r.id).toBe("vendor-answer");expect(r.choices[0]?.message.content).toBe("Hello");expect(r.usage).toEqual(usage.usage);
  expect(chunks.every(c=>c.id==="vendor-answer")).toBe(true);
 });
 it("keeps other providers strict",async()=>{await expect(read([prelude,payload,finished,usage],false)).rejects.toThrow("identity_changed");});
 it("rejects a different identity in payload chunks",async()=>{await expect(read([prelude,payload,{...finished,id:"another-answer"},usage])).rejects.toThrow("identity_changed");});
 it("rejects an unpaired usage identity",async()=>{await expect(read([prelude,payload,finished,{...usage,id:"another-envelope"}])).rejects.toThrow("identity_changed");});
 it("never discards nonempty content in a purported prelude",async()=>{await expect(read([{...prelude,choices:[{...prelude.choices[0],delta:{role:"assistant",content:"Other answer"}}]},payload,finished,usage])).rejects.toThrow("identity_changed");});
 it("requires the terminal marker and complete usage",async()=>{
  await expect(read([prelude,payload,finished,usage],true,false)).rejects.toThrow("incomplete");
  await expect(read([prelude,payload,finished])).rejects.toThrow("incomplete");
 });
});
