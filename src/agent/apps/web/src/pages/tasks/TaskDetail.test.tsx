// @vitest-environment jsdom
import type { InboxTask } from "@mycellios/contracts";
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
 expect(open).toHaveBeenCalledExactlyOnceWith();expect(expand).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
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
const ask={id:"m-ask",threadId:"kuma",runId:"run-1",seq:4,role:"bot",createdAt:new Date().toISOString(),blocks:[{kind:"ask",text:"Which cluster?",status:"pending"}]};
it('offers to answer a pending question in the chat, at that question',async()=>{
 const waiting={...row,runId:"run-1",status:"waiting_input" as const};
 read.mockResolvedValue({item:waiting,thread:{messages:[ask],olderCursor:null}});
 await render(waiting);
 const button=[...host.querySelectorAll('button')].find(button=>button.textContent==="Answer in the chat");
 expect(button).toBeTruthy();
 await act(()=>button!.click());
 expect(open).toHaveBeenCalledExactlyOnceWith("m-ask");
 expect(send).not.toHaveBeenCalled();
});
it('does not offer the chat for a question that was already answered',async()=>{
 const done={...row,runId:"run-1",status:"completed" as const};
 read.mockResolvedValue({item:done,thread:{messages:[{...ask,blocks:[{...ask.blocks[0],status:"answered",answer:"prod"}]}],olderCursor:null}});
 await render(done);
 expect([...host.querySelectorAll('button')].some(button=>button.textContent==="Answer in the chat")).toBe(false);
});
it('sends a takeover to the chat, where the computer can be handed over',async()=>{
 const takeover={...row,runId:"run-1",status:"waiting_takeover" as const};
 read.mockResolvedValue({item:takeover,thread:{messages:[],olderCursor:null}});
 await render(takeover);
 const button=[...host.querySelectorAll('button')].find(button=>button.textContent==="Open in the chat");
 await act(()=>button!.click());
 expect(open).toHaveBeenCalledExactlyOnceWith();
});
it('says the Mico opened the conversation and shows why its last turn failed',async()=>{
 const failed={...row,runId:"run-1",status:"completed" as const,outcome:"failed" as const,lastError:"The cluster refused the token.",startedBy:"agent" as const};
 read.mockResolvedValue({item:failed,thread:{messages:[],olderCursor:null}});
 await act(()=>root.render(<TaskDetail item={failed} bot={{id:"devops",name:"DevOps"} as never} client={client} scope="owner/space" onClose={()=>{}} onChanged={()=>{}} expanded={false} onExpand={expand} onOpenChat={open}/>));
 expect(host.querySelector('[data-testid="task-started-by-mico"]')?.textContent).toBe("DevOps opened this conversation");
 expect(host.querySelector('[data-testid="conversation-failure"]')?.textContent).toContain("The cluster refused the token.");
});
it('keeps its resizable edge beside the list and drops it when expanded',async()=>{
 await act(()=>root.render(<TaskDetail item={row} client={client} scope="owner/space" onClose={()=>{}} onChanged={()=>{}} expanded={false} onExpand={expand} onOpenChat={open} width={512} edge={<hr data-testid="edge"/>}/>));
 expect(host.querySelector<HTMLElement>('[data-testid="task-detail"]')!.style.getPropertyValue("--task-panel-width")).toBe("512px");
 expect(host.querySelector('[data-testid="edge"]')).toBeTruthy();
 await act(()=>root.render(<TaskDetail item={row} client={client} scope="owner/space" onClose={()=>{}} onChanged={()=>{}} expanded onExpand={expand} onOpenChat={open} width={512} edge={<hr data-testid="edge"/>}/>));
 expect(host.querySelector('[data-testid="edge"]')).toBeNull();
});
