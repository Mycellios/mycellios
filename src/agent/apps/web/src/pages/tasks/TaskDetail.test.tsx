// @vitest-environment jsdom
import type { InboxTask } from "@rakazo/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray,...v:unknown[])=>String.raw(s,...v)}),Trans:({children}:{children:ReactNode})=>children}));
vi.mock("./TaskComposer",()=>({TaskComposer:()=>null}));
import { TaskDetail } from "./TaskDetail";
let root:Root,host:HTMLDivElement;
const row:InboxTask={id:"inbox-kuma",botId:"devops",threadId:"kuma",title:"Migrar Kuma",runId:null,status:null,error:null,progress:null,unread:false,archivedAt:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const read=vi.fn(),archive=vi.fn(),open=vi.fn(),expand=vi.fn(),send=vi.fn();
const client={taskInbox:{read,archive,send}} as unknown as RpcClient;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();vi.clearAllMocks();read.mockResolvedValue({item:row,thread:{messages:[],olderCursor:null}});archive.mockResolvedValue({ok:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(item=row){await act(()=>root.render(<TaskDetail item={item} client={client} scope="owner/space" onClose={()=>{}} onChanged={()=>{}} expanded={false} onExpand={expand} onOpenChat={open}/>));}
it('opens the existing conversation without sending or confusing it with expanding the panel',async()=>{
 await render();
 await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Open conversation"]')!.click());
 expect(open).toHaveBeenCalledOnce();expect(expand).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Expand conversation"]')!.click());
 expect(expand).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledWith({id:"inbox-kuma"});
});
it('archives and restores metadata of the same thread without deleting the conversation',async()=>{
 await render();
 await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Archive task"]')!.click());
 expect(archive).toHaveBeenCalledWith({id:"inbox-kuma",archived:true});
 const archived={...row,archivedAt:new Date().toISOString()};
 read.mockResolvedValue({item:archived,thread:{messages:[],olderCursor:null}});
 await act(()=>root.unmount());root=createRoot(host);
 await render(archived);
 await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Restore task"]')!.click());
 expect(archive).toHaveBeenLastCalledWith({id:"inbox-kuma",archived:false});
 expect(send).not.toHaveBeenCalled();
});
