import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createDb,asSystem,runAsTenant,type PrismaClient} from "@mycellios/db";
import {MarkdownMemoryStore} from "@mycellios/memory";
import {reviewLocalMemory} from "./local-memory-review.js";
const url=process.env.TEST_DATABASE_URL;
const suite=url?describe:describe.skip;
suite("local memory on PostgreSQL and actual tenant policies",()=>{
 let db:ReturnType<typeof createDb>,p:PrismaClient,system:PrismaClient,scope:{spaceId:string;userId:string;botId:string},store:MarkdownMemoryStore,thread:string;
 const model={provider:"openai-compatible",id:"mycellios/managed/antseed/deepseek-v4-flash",baseUrl:"https://mycellios.com/v1",apiKey:"test-owned-key"};
 beforeEach(async()=>{
  db=createDb(url!,{encryptContent:true});p=db.prisma;system=asSystem(p);const id=randomUUID();scope={userId:"memory-user-"+id,spaceId:"memory-space-"+id,botId:"memory-bot-"+id};
  await system.user.create({data:{id:scope.userId,name:"Memory test",email:id+"@example.invalid",micoDefaults:{memoryReview:{enabled:true,interval:20,dailyLimitMicrounits:1000}}}});
  await system.organization.create({data:{id:scope.spaceId,name:"Memory test",slug:scope.spaceId,createdAt:new Date(),spaces:{create:{id:scope.spaceId,name:"Test"}}}});
  await system.member.create({data:{id:"member-"+id,userId:scope.userId,organizationId:scope.spaceId,role:"owner",createdAt:new Date()}});
  await system.spaceMember.create({data:{id:"space-member-"+id,...{userId:scope.userId,spaceId:scope.spaceId},organizationId:scope.spaceId,role:"owner",createdAt:new Date()}});
  await system.bot.create({data:{id:scope.botId,...{userId:scope.userId,spaceId:scope.spaceId},name:"Mico",color:"ink"}});
  thread=await makeThread();store=new MarkdownMemoryStore(p);
 });
 afterEach(async()=>{if(!db)return;try{await system.organization.deleteMany({where:{id:scope.spaceId}});await system.user.deleteMany({where:{id:scope.userId}});}finally{await p.$disconnect();await db.pool.end();}});
 async function makeThread(){const id=randomUUID();await system.thread.create({data:{id,userId:scope.userId,spaceId:scope.spaceId,taskBotId:scope.botId,projectKey:"memory-test",taskKey:id,nextMessageSeq:6}});
  for(let seq=0;seq<6;seq++)await system.message.create({data:{id:id+"-"+seq,threadId:id,seq,role:seq%2?"bot":"user",createdAt:new Date(Date.now()-20*60000+seq*100),blocks:[{kind:"text",text:seq%2?"Noted":"Kuma is hosted on Railway"}]}});return id;
 }
 function context(){return {...scope,operationId:"test",traceId:"test",signal:new AbortController().signal};}
 function fixture(mode:"completed"|"pending"="completed"){
  const transport=vi.fn(async(input:unknown,init?:RequestInit)=>{const path=new URL(String(input)).pathname;
   if(path.endsWith('/quote'))return Response.json({token:"quote",maximumMicrounits:1000});
   if(path.endsWith('/reconcile'))return Response.json({status:"pending_reconciliation"},{status:202});
   if(mode==="pending")return Response.json({status:"pending_reconciliation"},{status:202});
   const request=JSON.parse(String(init!.body)).request;const data=JSON.parse(request.messages[1].content);const source=data.messages.find((m:any)=>m.role==="user").id;
   return Response.json({status:"completed",response:{choices:[{finish_reason:"stop",message:{content:JSON.stringify({facts:[{key:"kuma-host",scope:"task",text:"Kuma is hosted on Railway",sourceMessageId:source}]})}}],mycellios:{creditsMicrounits:500}}});
  });const jobs={enqueue:vi.fn(async()=>{}),cancel:vi.fn(async()=>{}),close:vi.fn(async()=>{})};return {prisma:p,memory:store,jobs,resolveModel:vi.fn(async()=>model),transport};
 }
 it("keeps task notes out of other conversations and rejects other Micos",async()=>{await runAsTenant(scope,async()=>{
  const other=await makeThread();await store.commit({scope:"bot",botId:scope.botId,taskThreadId:thread,path:`tasks/${thread}/facts.md`,content:"Railway decision"},context());
  expect((await store.read({scope:"bot",botId:scope.botId,taskThreadId:thread},context())).documents).toHaveLength(1);
  expect((await store.read({scope:"bot",botId:scope.botId,taskThreadId:other},context())).documents).toHaveLength(0);
  await expect(store.read({scope:"bot",botId:"other-mico"},context())).rejects.toThrow("another Mico");
 });});
 it("uses serializable admission to keep concurrent essential notes below the cap",async()=>{await runAsTenant(scope,async()=>{
  const values=await Promise.allSettled(["a","b"].map(path=>store.commit({scope:"bot",botId:scope.botId,path:path+".md",content:path.repeat(5000),inclusion:"essential",selectionByUser:true},context())));
  expect(values.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  expect((await store.read({scope:"bot",botId:scope.botId},context())).documents).toHaveLength(1);
 });});
 it("stores a real task-scoped review and encrypts its snapshot and facts",async()=>{const deps=fixture();await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  const reviews=await system.localMemoryReview.findMany({where:{threadId:thread}});expect(reviews).toHaveLength(1);expect(reviews[0]!.status).toBe("completed");expect(reviews[0]!.chargedMicrounits).toBe(500);
  const docs=await system.memoryDocument.findMany({where:{spaceId:scope.spaceId}});expect(docs).toHaveLength(1);expect(docs[0]!.taskThreadId).toBe(thread);
  const raw=await system.$queryRaw<Array<{result:string}>>`SELECT result::text FROM local_memory_reviews WHERE "threadId"=${thread}`;expect(raw[0]!.result).not.toContain("Railway");
 });
 it("never resubmits a pending paid POST, even on a second worker delivery",async()=>{const deps=fixture("pending");await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  const paths=deps.transport.mock.calls.map(([input])=>new URL(String(input)).pathname);
  expect(paths.filter(path=>path.endsWith('/execute'))).toHaveLength(1);expect(paths.filter(path=>path.endsWith('/reconcile'))).toHaveLength(1);
  expect(await system.localMemoryReview.count({where:{threadId:thread}})).toBe(1);
 });
 it("admits at most one paid review when two conversations compete for the daily budget",async()=>{
  const other=await makeThread();const deps=fixture();await runAsTenant(scope,()=>Promise.all([reviewLocalMemory(deps,thread),reviewLocalMemory(deps,other)]));
  expect(deps.transport.mock.calls.filter(([input])=>String(input).endsWith('/execute'))).toHaveLength(1);
  const sum=await system.localMemoryReview.aggregate({where:{spaceId:scope.spaceId},_sum:{maximumMicrounits:true}});expect(sum._sum.maximumMicrounits).toBe(1000);
 });
 it("does not expose review records without the owning tenant",async()=>{const deps=fixture("pending");await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  expect(await p.localMemoryReview.findMany()).toEqual([]);
  expect(await runAsTenant({spaceId:scope.spaceId,userId:"foreign-user"},()=>p.localMemoryReview.findMany())).toEqual([]);
  expect((await runAsTenant(scope,()=>p.localMemoryReview.findMany())).length).toBe(1);
 });
 it("preserves a user-controlled note when an automatic review proposes a replacement",async()=>{
  await runAsTenant(scope,()=>store.commit({scope:"bot",botId:scope.botId,taskThreadId:thread,path:`tasks/${thread}/reviews/kuma-host.md`,content:"User corrected this: use the new host",selectionByUser:true},context()));
  const deps=fixture();await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  const doc=await system.memoryDocument.findFirst({where:{taskThreadId:thread}});expect(doc!.content).toBe("User corrected this: use the new host");
 });
 it("does not execute a quote after membership is revoked",async()=>{
  const deps=fixture();const original=deps.transport.getMockImplementation()!;
  deps.transport.mockImplementation(async(input,init)=>{const response=await original(input,init);if(String(input).endsWith('/quote'))await system.spaceMember.deleteMany({where:{userId:scope.userId,spaceId:scope.spaceId}});return response;});
  await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));expect(deps.transport.mock.calls.some(([input])=>String(input).endsWith('/execute'))).toBe(false);
 });
 it("does not apply paid output after the conversation context was reset",async()=>{
  const deps=fixture();const original=deps.transport.getMockImplementation()!;
  deps.transport.mockImplementation(async(input,init)=>{const response=await original(input,init);if(String(input).endsWith('/execute'))await system.thread.update({where:{id:thread},data:{historyCompactionGeneration:{increment:1},contextStartSeq:6}});return response;});
  await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));expect(await system.memoryDocument.count({where:{spaceId:scope.spaceId}})).toBe(0);
  const row=await system.localMemoryReview.findFirst({where:{threadId:thread}});expect(row!.chargedMicrounits).toBe(500);expect(row!.status).toBe("failed");
 });
 it("does not switch payer after quote admission",async()=>{
  const deps=fixture();deps.resolveModel.mockResolvedValueOnce(model).mockResolvedValue({...model,apiKey:"a-different-owned-key"});
  await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));expect(deps.transport.mock.calls.some(([input])=>String(input).endsWith('/execute'))).toBe(false);
 });
 it("records invalid model output as a paid failure and does not pay for the batch again",async()=>{
  const deps=fixture();const original=deps.transport.getMockImplementation()!;
  deps.transport.mockImplementation(async(input,init)=>{const response=await original(input,init);if(String(input).endsWith('/execute')){const result=await response.json();result.response.choices[0].message.content="invalid JSON";return Response.json(result);}return response;});
  await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  expect(deps.transport.mock.calls.filter(([input])=>String(input).endsWith('/execute'))).toHaveLength(1);
  const row=await system.localMemoryReview.findFirst({where:{threadId:thread}});expect(row!.status).toBe("failed");expect(row!.chargedMicrounits).toBe(500);
 });

 it("clears a reservation only after the gateway confirms release without replaying the purchase",async()=>{
  const deps=fixture("pending");await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  const original=deps.transport.getMockImplementation()!;
  deps.transport.mockImplementation(async(input,init)=>String(input).endsWith('/reconcile')?Response.json({status:"released"},{status:202}):original(input,init));
  await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));await runAsTenant(scope,()=>reviewLocalMemory(deps,thread));
  const row=await system.localMemoryReview.findFirst({where:{threadId:thread}});expect(row!.status).toBe("failed");expect(row!.maximumMicrounits).toBe(0);expect(row!.chargedMicrounits).toBe(0);
  expect(deps.transport.mock.calls.filter(([input])=>String(input).endsWith('/execute'))).toHaveLength(1);
 });});
