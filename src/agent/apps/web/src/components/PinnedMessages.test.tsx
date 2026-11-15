// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {RpcClient} from "../lib/rpc";
vi.mock("@lingui/react/macro",()=>({Trans:({children}:{children:unknown})=>children,useLingui:()=>({t:(strings:TemplateStringsArray)=>strings.join(""),i18n:{locale:"en"}})}));
vi.mock("../lib/general-preferences",()=>({useGeneralPreferences:()=>({compactMessageActions:true})}));
import {MessagePinsContext,PinnedMessagesButton,useMessagePins} from "./PinnedMessages";
import {MessageHoverActions} from "../pages/shell/message-hover-actions";

const roots:ReturnType<typeof createRoot>[]=[];
beforeEach(()=>vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true));
afterEach(async()=>{for(const root of roots.splice(0))await act(()=>root.unmount());document.body.innerHTML="";});
const pin={messageId:"message",seq:0,role:"bot" as const,preview:"La decisión importante",createdAt:new Date(0).toISOString(),pinnedAt:new Date(0).toISOString()};
const buttons=(text:string)=>Array.from(document.querySelectorAll<HTMLElement>('button,[role="menuitem"]')).find(b=>b.textContent===text)!;

it("pins from the message menu, jumps to the original and unpins without deleting it",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  let pinned=false;
  const list=vi.fn(async()=>({threadId:"thread",pins:pinned?[pin]:[]}));
  const set=vi.fn(async(input:{pinned:boolean})=>{pinned=input.pinned;return {ok:true as const};});
  const rpc={threads:{pinned:list,setPin:set}} as unknown as RpcClient;
  const jump=vi.fn();
  function App(){const state=useMessagePins(rpc,"owner-space",{botId:"mico",taskThreadId:"thread"},"thread");return <MessagePinsContext.Provider value={state.actions}><PinnedMessagesButton state={state} onJump={jump}/><MessageHoverActions message={{id:"message",threadId:"thread",seq:0,role:"bot",blocks:[{kind:"text",text:pin.preview}],createdAt:pin.createdAt}} side="end" onReply={vi.fn()} onMarkUnread={vi.fn()} onReact={vi.fn()}/></MessagePinsContext.Provider>;}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  await act(()=>root.render(<QueryClientProvider client={client}><App/></QueryClientProvider>));
  await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click());
  await act(()=>buttons("Pin message").click());
  await act(()=>client.invalidateQueries());
  expect(set).toHaveBeenCalledWith({botId:"mico",taskThreadId:"thread",messageId:"message",pinned:true});
  await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Pinned messages"]')!.click());
  expect(document.body.textContent).toContain(pin.preview);
  const preview=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent?.includes(pin.preview))!;
  await act(()=>preview.click());expect(jump).toHaveBeenCalledWith("message");
  await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Pinned messages"]')!.click());
  await act(()=>document.querySelector<HTMLButtonElement>('button[aria-label="Unpin message"]')!.click());
  await act(()=>client.invalidateQueries());
  expect(set).toHaveBeenLastCalledWith({botId:"mico",taskThreadId:"thread",messageId:"message",pinned:false});
  await vi.waitFor(async()=>{
    await act(async()=>{});
    expect(document.body.textContent).toContain("Pin a message from its menu to find it here.");
  });
  client.clear();
});

it("clears the previous conversation's pins immediately when scope changes",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const rpc={threads:{pinned:vi.fn().mockResolvedValueOnce({threadId:"a",pins:[pin]}).mockReturnValue(new Promise(()=>{}))}} as unknown as RpcClient;
  function App({thread}:{thread:string}){const state=useMessagePins(rpc,`owner-${thread}`,{botId:"mico",taskThreadId:thread},thread);return <div>{[...state.actions.ids].join(",")}</div>;}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  const render=(thread:string)=>root.render(<QueryClientProvider client={client}><App thread={thread}/></QueryClientProvider>);
  await act(()=>render("a"));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});
  expect(host.textContent).toBe("message");
  await act(()=>render("b"));expect(host.textContent).toBe("");client.clear();
});

it("does not read pins before a conversation is available",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}}),list=vi.fn();
  const rpc={threads:{pinned:list}} as unknown as RpcClient;
  function App(){const state=useMessagePins(rpc,"unloaded",null,undefined);return <span>{state.pins.length}</span>;}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  await act(()=>root.render(<QueryClientProvider client={client}><App/></QueryClientProvider>));
  expect(host.textContent).toBe("0");expect(list).not.toHaveBeenCalled();client.clear();
});
