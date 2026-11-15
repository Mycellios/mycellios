import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({resolve:vi.fn(),list:vi.fn(),set:vi.fn(),page:vi.fn(),visible:vi.fn()}));
vi.mock("./thread-target.js",()=>({resolveThreadTarget:mocks.resolve}));
vi.mock("./thread-message-pages.js",()=>({loadMessagePage:mocks.page,withoutPeerRunMessages:mocks.visible}));
vi.mock("@rakazo/db",async original=>({...await original<object>(),listMessagePins:mocks.list,setMessagePin:mocks.set}));
import { messagePinRoutes } from "./routes/message-pins.js";
const actor={userId:"owner",spaceId:"space"};
const handler={handler:(fn:unknown)=>fn};
const findMany=vi.fn();
const routes=messagePinRoutes({deps:{prisma:{message:{findMany}}},authed:{threads:{pinned:handler,setPin:handler}}} as never);
const call=(fn:unknown,input:unknown)=>(fn as (v:unknown)=>Promise<unknown>)({context:{actor},input});
beforeEach(()=>{
  vi.clearAllMocks();mocks.resolve.mockResolvedValue({threadId:"task"});mocks.set.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([{messageId:"m",pinnedAt:new Date(0)}]);
  findMany.mockResolvedValue([{id:"m",seq:5,role:"bot",blocks:[{kind:"text",text:"Importante"}],runId:null,createdAt:new Date(0)}]);
  mocks.visible.mockImplementation((_db,rows)=>rows);
  mocks.page.mockResolvedValue({messages:[{id:"m",role:"bot"}]});
});
it("lists only this account's exact resolved conversation and derives the current preview",async()=>{
  await expect(call(routes.pinned,{botId:"mico",taskThreadId:"task"})).resolves.toEqual({threadId:"task",pins:[{messageId:"m",seq:5,role:"bot",preview:"Importante",createdAt:new Date(0).toISOString(),pinnedAt:new Date(0).toISOString()}]});
  expect(mocks.list).toHaveBeenCalledWith(expect.anything(),actor,"task");
  expect(findMany).toHaveBeenCalledWith({where:{threadId:"task",id:{in:["m"]},role:{in:["user","bot"]}}});
});
it("does not expose hidden background messages",async()=>{
  mocks.visible.mockResolvedValue([]);
  await expect(call(routes.pinned,{botId:"mico"})).resolves.toEqual({threadId:"task",pins:[]});
});
it("rejects foreign conversations before reading or changing any pins",async()=>{
  mocks.resolve.mockRejectedValue(new Error("Not found"));
  await expect(call(routes.pinned,{botId:"foreign"})).rejects.toThrow();
  await expect(call(routes.setPin,{botId:"foreign",messageId:"m",pinned:true})).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();
});
it("refuses a hidden, system or foreign-thread message even when the conversation is owned",async()=>{
  for(const messages of [[],[{id:"other",role:"bot"}],[{id:"m",role:"system"}]]){
    mocks.page.mockResolvedValue({messages});
    await expect(call(routes.setPin,{botId:"mico",messageId:"m",pinned:true})).rejects.toThrow();
  }
  expect(mocks.set).not.toHaveBeenCalled();
});
it.each([true,false])("sets the explicit desired state %s without sending an agent message",async pinned=>{
  await expect(call(routes.setPin,{botId:"mico",messageId:"m",pinned})).resolves.toEqual({ok:true});
  expect(mocks.set).toHaveBeenCalledWith(expect.anything(),actor,"task","m",pinned);
});
it("bounds long previews",async()=>{
  const rows=await findMany(); rows[0].blocks[0].text="a".repeat(5000);findMany.mockResolvedValue(rows);
  const result=await call(routes.pinned,{botId:"mico"}) as {pins:{preview:string}[]};
  expect(result.pins[0]!.preview.length).toBeLessThanOrEqual(800);
});
