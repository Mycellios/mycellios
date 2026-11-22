import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({resolve:vi.fn(),list:vi.fn(),listMico:vi.fn(),set:vi.fn(),page:vi.fn(),visible:vi.fn(),getBot:vi.fn(),search:vi.fn()}));
vi.mock("./thread-target.js",()=>({resolveThreadTarget:mocks.resolve}));
vi.mock("./thread-message-pages.js",()=>({loadMessagePage:mocks.page,withoutPeerRunMessages:mocks.visible}));
vi.mock("./search.js",()=>({searchThreadMessages:mocks.search}));
vi.mock("@mycellios/db",async original=>({...await original<object>(),listMessagePins:mocks.list,listMicoMessagePins:mocks.listMico,setMessagePin:mocks.set,createRepos:()=>({getBot:mocks.getBot})}));
import { messagePinRoutes, micoPinRoutes } from "./routes/message-pins.js";
const actor={userId:"owner",spaceId:"space"};
const handler={handler:(fn:unknown)=>fn};
const findMany=vi.fn(),botNames=vi.fn(),threadFind=vi.fn();
const ctx={deps:{prisma:{message:{findMany},bot:{findMany:botNames},thread:{findFirst:threadFind}}},authed:{threads:{pinned:handler,setPin:handler,searchMessages:handler},pins:{mico:handler,unpin:handler}}} as never;
const routes=messagePinRoutes(ctx);
const mico=micoPinRoutes(ctx).pins;
const call=(fn:unknown,input:unknown)=>(fn as (v:unknown)=>Promise<unknown>)({context:{actor},input});
beforeEach(()=>{
  vi.clearAllMocks();mocks.resolve.mockResolvedValue({threadId:"task"});mocks.set.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([{messageId:"m",pinnedAt:new Date(0),pinnedByBotId:null}]);
  findMany.mockResolvedValue([{id:"m",threadId:"task",seq:5,role:"bot",blocks:[{kind:"text",text:"Importante"}],runId:null,createdAt:new Date(0)}]);
  botNames.mockResolvedValue([{id:"mico",name:"Nova"}]);
  mocks.visible.mockImplementation((_db,rows)=>rows);
  mocks.page.mockResolvedValue({messages:[{id:"m",role:"bot"}]});
  mocks.getBot.mockResolvedValue({id:"mico"});
});
it("lists only this account's exact resolved conversation and derives the current preview",async()=>{
  await expect(call(routes.pinned,{botId:"mico",taskThreadId:"task"})).resolves.toEqual({threadId:"task",pins:[{messageId:"m",seq:5,role:"bot",preview:"Importante",createdAt:new Date(0).toISOString(),pinnedAt:new Date(0).toISOString(),pinnedByBotId:null}]});
  expect(mocks.list).toHaveBeenCalledWith(expect.anything(),actor,"task");
  expect(findMany).toHaveBeenCalledWith({where:{threadId:"task",id:{in:["m"]},role:{in:["user","bot"]}}});
  expect(botNames).not.toHaveBeenCalled();
});
it("marks a pin the Mico made with its name",async()=>{
  mocks.list.mockResolvedValue([{messageId:"m",pinnedAt:new Date(0),pinnedByBotId:"mico"}]);
  const result=await call(routes.pinned,{botId:"mico"}) as {pins:Array<{pinnedByBotId:string;pinnedByName:string}>};
  expect(result.pins[0]).toMatchObject({pinnedByBotId:"mico",pinnedByName:"Nova"});
});
it("does not expose hidden background messages",async()=>{
  mocks.visible.mockResolvedValue([]);
  await expect(call(routes.pinned,{botId:"mico"})).resolves.toEqual({threadId:"task",pins:[]});
});
it("rejects foreign conversations before reading or changing any pins",async()=>{
  mocks.resolve.mockRejectedValue(new Error("Not found"));
  await expect(call(routes.pinned,{botId:"foreign"})).rejects.toThrow();
  await expect(call(routes.setPin,{botId:"foreign",messageId:"m",pinned:true})).rejects.toThrow();
  await expect(call(routes.searchMessages,{botId:"foreign",q:"x"})).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();expect(mocks.search).not.toHaveBeenCalled();
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
it("lists one Mico's pins across its conversations with their conversation and author",async()=>{
  mocks.listMico.mockResolvedValue([
    {messageId:"m",threadId:"task",pinnedAt:new Date(1),pinnedByBotId:"mico",botId:null,taskBotId:"mico",projectKey:"mico:mico",taskKey:"mico-task:mico:a",title:"Informe final",archivedAt:new Date(0)},
    {messageId:"n",threadId:"main",pinnedAt:new Date(0),pinnedByBotId:null,botId:"mico",taskBotId:null,projectKey:null,taskKey:null,title:null,archivedAt:null},
    {messageId:"gone",threadId:"task",pinnedAt:new Date(0),pinnedByBotId:null,botId:null,taskBotId:"mico",projectKey:null,taskKey:null,title:null,archivedAt:null},
  ]);
  findMany.mockResolvedValue([
    {id:"m",threadId:"task",seq:5,role:"bot",blocks:[{kind:"text",text:"Borrador final"}],runId:null,createdAt:new Date(0)},
    {id:"n",threadId:"main",seq:2,role:"user",blocks:[{kind:"text",text:"Decisión"}],runId:null,createdAt:new Date(0)},
  ]);
  const result=await call(mico.mico,{botId:"mico"}) as {pins:Array<Record<string,unknown>>};
  expect(mocks.getBot).toHaveBeenCalledWith(actor,"mico",{includeArchived:true});
  expect(mocks.listMico).toHaveBeenCalledWith(expect.anything(),actor,"mico");
  expect(findMany).toHaveBeenCalledWith({where:{threadId:{in:["task","main"]},id:{in:["m","n","gone"]},role:{in:["user","bot"]}}});
  expect(result.pins).toEqual([
    expect.objectContaining({messageId:"m",threadId:"task",taskThreadId:"task",conversationTitle:"Informe final",archived:true,pinnedByBotId:"mico",pinnedByName:"Nova",preview:"Borrador final"}),
    expect.objectContaining({messageId:"n",threadId:"main",taskThreadId:null,conversationTitle:"",archived:false,pinnedByBotId:null}),
  ]);
});
it("refuses the combined list for a Mico the actor does not own",async()=>{
  mocks.getBot.mockRejectedValue(new Error("Not found"));
  await expect(call(mico.mico,{botId:"foreign"})).rejects.toThrow();
  await expect(call(mico.unpin,{botId:"foreign",threadId:"task",messageId:"m"})).rejects.toThrow();
  expect(mocks.listMico).not.toHaveBeenCalled();expect(mocks.set).not.toHaveBeenCalled();
});
it("unpins from the combined list only inside the Mico's own conversations",async()=>{
  threadFind.mockResolvedValueOnce({id:"task"});
  await expect(call(mico.unpin,{botId:"mico",threadId:"task",messageId:"m"})).resolves.toEqual({ok:true});
  expect(threadFind).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:"task",spaceId:"space",userId:"owner",groupId:null,OR:[{botId:"mico"},{botId:null,taskBotId:"mico"}]})}));
  expect(mocks.set).toHaveBeenCalledWith(expect.anything(),actor,"task","m",false);
  threadFind.mockResolvedValueOnce(null);
  await expect(call(mico.unpin,{botId:"mico",threadId:"group-thread",messageId:"m"})).rejects.toThrow();
  expect(mocks.set).toHaveBeenCalledTimes(1);
});
it("searches only the resolved conversation for in-chat search",async()=>{
  mocks.search.mockResolvedValue({matches:[{messageId:"m",seq:5,snippet:"Importante"}],more:false});
  await expect(call(routes.searchMessages,{botId:"mico",taskThreadId:"task",q:"importante"})).resolves.toEqual({threadId:"task",matches:[{messageId:"m",seq:5,snippet:"Importante"}],more:false});
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(),actor,"task","importante");
});
