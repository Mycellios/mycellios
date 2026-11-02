import { describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import type { Actor } from "@rakazo/contracts";
import { agentUsage } from "./agent-usage.js";
import { createRouter } from "./router.js";
import type { RouterDeps } from "./router.js";
const actor={userId:"owner",spaceId:"space",email:"test@example.test"} as Actor;
function fixture(waiting=false) {
 const all=[
  {botId:"a",_count:{id:2,inputTokens:2,outputTokens:2,totalTokens:2},_sum:{inputTokens:1000,outputTokens:100,totalTokens:1100}},
  {botId:"b",_count:{id:2,inputTokens:1,outputTokens:1,totalTokens:1},_sum:{inputTokens:200,outputTokens:20,totalTokens:220}},
  {botId:null,_count:{id:1,inputTokens:1,outputTokens:1,totalTokens:1},_sum:{inputTokens:0,outputTokens:0,totalTokens:0}},
 ];
 const group=vi.fn(async(q:{where:{pricingSnapshot?:unknown;costSource?:unknown};_sum?:{costUsd?:boolean}})=>{
  if(q.where.pricingSnapshot)return waiting?[{botId:"b",_count:{id:1}}]:[];
  if(q.where.costSource)return[{botId:"b",_count:{id:1}}];
  if(q._sum?.costUsd)return[{botId:"a",_count:{id:2},_sum:{costUsd:0.3}},{botId:"b",_count:{id:1},_sum:{costUsd:0.1}},{botId:null,_count:{id:1},_sum:{costUsd:0}}];
  return all;
 });
 const bots=vi.fn(async()=>[{id:"a",name:"First",archivedAt:null},{id:"b",name:"Second",archivedAt:new Date()},{id:"empty",name:"Unused",archivedAt:null}]);
 const runs=vi.fn(async()=>[]);
 const deps={prisma:{bot:{findMany:bots},usageRecord:{groupBy:group},run:{groupBy:runs}},env:{sandboxProvider:"fake"}} as unknown as RouterDeps;
 return{deps,group,bots,runs};
}
describe("agent lifetime usage",()=>{
 it("counts raw model calls once, retaining archived, empty and unassigned usage",async()=>{
  const f=fixture();const r=await agentUsage(f.deps,actor);
  expect(r.total).toMatchObject({modelCalls:5,inputTokens:null,knownInputTokens:1200,knownTotalTokens:1320,amountUsd:null,knownAmountUsd:0.4,unpricedCalls:1,estimatedCalls:1});
  expect(r.agents.find(x=>x.botId==="a")).toMatchObject({inputTokens:1000,outputTokens:100,totalTokens:1100,amountUsd:0.3,state:"confirmed"});
  expect(r.agents.find(x=>x.botId==="b")).toMatchObject({archived:true,inputTokens:null,knownInputTokens:200,state:"unavailable",knownAmountUsd:0.1});
  expect(r.agents.find(x=>x.botId==="empty")).toMatchObject({modelCalls:0,totalTokens:0,amountUsd:0});
  expect(r.agents.find(x=>x.botId===null)).toMatchObject({name:null,modelCalls:1,amountUsd:0});
 });
 it("keeps receipt settlement pending rather than advertising a free or complete total",async()=>{
  const f=fixture(true);const r=await agentUsage(f.deps,actor);expect(r.total.state).toBe("pending");expect(r.total.amountUsd).toBeNull();
 });
 it("scopes every aggregate to both user and space, without a recent-row limit",async()=>{
  const f=fixture();await agentUsage(f.deps,actor);
  for(const [q]of f.group.mock.calls){expect(q.where).toMatchObject({userId:"owner",spaceId:"space"});expect(q).not.toHaveProperty("take");}
  expect(f.bots).toHaveBeenCalledWith(expect.objectContaining({where:{userId:"owner",spaceId:"space"}}));
  expect(f.runs).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({userId:"owner",spaceId:"space"})}));
 });
 it("requires authentication at the actual RPC boundary",async()=>{
  const f=fixture();const router=createRouter(f.deps);const anon=createRouterClient(router,{context:{} as never});
  await expect(anon.usage.agents()).rejects.toMatchObject({code:"UNAUTHORIZED"});expect(f.group).not.toHaveBeenCalled();
  const client=createRouterClient(router,{context:{actor} as never});expect((await client.usage.agents()).total.modelCalls).toBe(5);
 });
});
