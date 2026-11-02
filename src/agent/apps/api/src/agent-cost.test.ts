import { describe, expect, it, vi } from "vitest";
import { agentCost } from "./agent-cost.js";
import type { RouterDeps } from "./router.js";
import type { Actor } from "@rakazo/contracts";
const actor = { userId: "owner", spaceId: "space" } as Actor;
function fixture({all=3,known=3,amount=0.6,estimated=0,pending=0,active=0,owned=true}={}) {
 const count=vi.fn(async({where})=>where.pricingSnapshot?pending:where.costSource?estimated:all);
 const aggregate=vi.fn(async()=>({_sum:{costUsd:amount},_count:{id:known}}));
 const bot=vi.fn(async()=>owned?{id:"bot"}:null);
 const run=vi.fn(async()=>active);
 const deps={prisma:{bot:{findFirst:bot},usageRecord:{count,aggregate},run:{count:run}}} as unknown as RouterDeps;
 return {deps,count,aggregate,bot,run};
}
describe("agent total cost",()=>{
 it("sums the full authorized history without a recent-record limit",async()=>{
  const f=fixture({all:1200,known:1200,amount:12.5});
  expect(await agentCost(f.deps,actor,"bot")).toMatchObject({botId:"bot",state:"confirmed",amountUsd:12.5,modelCalls:1200});
  for(const [query]of[...f.count.mock.calls,...f.aggregate.mock.calls,...f.run.mock.calls]){
   expect(query.where).toMatchObject({userId:"owner",spaceId:"space",botId:"bot"});expect(query).not.toHaveProperty("take");
  }
 });
 it.each([
  [{estimated:1},"estimated",0.6],
  [{known:2},"unavailable",null],
  [{known:2,pending:1},"pending",null],
  [{active:1},"pending",null],
  [{all:0,known:0,amount:0},"confirmed",0],
 ])("keeps unknown, pending, estimated and genuinely unused totals distinct",async(options,state,amount)=>{
  const f=fixture(options);expect(await agentCost(f.deps,actor,"bot")).toMatchObject({state,amountUsd:amount});
 });
 it("does not read another account's agent usage",async()=>{
  const f=fixture({owned:false});await expect(agentCost(f.deps,actor,"foreign")).rejects.toMatchObject({code:"NOT_FOUND"});
  expect(f.aggregate).not.toHaveBeenCalled();expect(f.count).not.toHaveBeenCalled();
 });
});
