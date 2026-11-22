// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {RpcClient} from "../lib/rpc";
vi.mock("@lingui/react/macro",()=>({Trans:({children}:{children:unknown})=>children,useLingui:()=>({t:(strings:TemplateStringsArray)=>strings.join(""),i18n:{locale:"en"}})}));
import {ChatSearchButton} from "./ChatSearch";

const roots:ReturnType<typeof createRoot>[]=[];
beforeEach(()=>vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true));
afterEach(async()=>{for(const root of roots.splice(0))await act(()=>root.unmount());document.body.innerHTML="";vi.useRealTimers();});

it("searches the open conversation and steps through matches with previous and next",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const searchMessages=vi.fn(async()=>({threadId:"thread",more:false,matches:[
    {messageId:"newest",seq:9,snippet:"budget v3"},{messageId:"middle",seq:5,snippet:"budget v2"},{messageId:"oldest",seq:1,snippet:"budget v1"}]}));
  const rpc={threads:{searchMessages}} as unknown as RpcClient;
  const jump=vi.fn();
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  await act(()=>root.render(<QueryClientProvider client={client}><ChatSearchButton rpc={rpc} scope="owner" target={{botId:"mico",taskThreadId:"thread"}} threadId="thread" onJump={jump}/></QueryClientProvider>));
  await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Search messages"]')!.click());
  const input=document.querySelector<HTMLInputElement>('input[aria-label="Search messages"]')!;
  await act(async()=>{
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    setter.call(input,"budget");input.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await vi.waitFor(async()=>{await act(async()=>{});expect(jump).toHaveBeenCalledWith("newest");});
  expect(searchMessages).toHaveBeenCalledWith({botId:"mico",taskThreadId:"thread",q:"budget"});
  const previous=document.querySelector<HTMLButtonElement>('button[aria-label="Previous match"]')!;
  const next=document.querySelector<HTMLButtonElement>('button[aria-label="Next match"]')!;
  await act(()=>previous.click());expect(jump).toHaveBeenLastCalledWith("middle");
  await act(()=>previous.click());expect(jump).toHaveBeenLastCalledWith("oldest");
  await act(()=>next.click());expect(jump).toHaveBeenLastCalledWith("middle");
  await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));});
  expect(jump).toHaveBeenLastCalledWith("oldest");
  await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true}));});
  expect(jump).toHaveBeenLastCalledWith("middle");
  expect(document.body.textContent).toContain("budget v2");
  client.clear();
});

it("does not search before something is typed",async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const searchMessages=vi.fn();
  const rpc={threads:{searchMessages}} as unknown as RpcClient;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);roots.push(root);
  await act(()=>root.render(<QueryClientProvider client={client}><ChatSearchButton rpc={rpc} scope="owner" target={{groupId:"group"}} threadId="thread" onJump={vi.fn()}/></QueryClientProvider>));
  await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Search messages"]')!.click());
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,300));});
  expect(searchMessages).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Type to search this conversation.");
  client.clear();
});
