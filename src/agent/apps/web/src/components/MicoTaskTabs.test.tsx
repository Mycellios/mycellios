// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "../lib/rpc";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
import { fitConversationTabs, MicoTaskTabs } from "./MicoTaskTabs";
import { queryClient } from "../lib/query";

const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => { localStorage.clear(); queryClient.clear(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(async () => { for (const root of roots.splice(0)) await act(() => root.unmount()); document.body.innerHTML = ""; });

describe("Mico task navigation", () => {
  it("creates an independent conversation in the same Mico and retries without duplicating it", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const select = vi.fn();
    const open = vi.fn().mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({ threadId: "kuma" });
    const list = vi.fn().mockResolvedValue([]);
    const rpc = { development: { list, open } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="infra" scope="infra" rpc={rpc} onSelect={select} />));
    expect(host.textContent).not.toContain("General");
    const createButton = host.querySelector<HTMLButtonElement>('button[aria-label="New conversation"]')!;
    expect(createButton.textContent).toBe("");
    expect(host.querySelector('button[aria-label="Conversations"]')).not.toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="New conversation"]')!.click());
    expect(document.querySelector("input")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(open).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    const request = open.mock.calls[0]![0];
    await act(() => createButton.click());
    expect(open.mock.calls[1]![0]).toEqual(request);
    expect(request).toMatchObject({ botId: "infra", projectKey: "mico:infra" });
    expect(request).not.toHaveProperty("title");
    expect(select).toHaveBeenLastCalledWith("kuma");
  });

  it("ignores repeated clicks while creating and opens an unnamed tab directly", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    let finish!: (value: {threadId: string}) => void;
    const open = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const list = vi.fn().mockResolvedValue([]), select = vi.fn();
    const rpc = { development: { list, open } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs botId="mico" scope="fast" rpc={rpc} onSelect={select} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="New conversation"]')!;
    await act(() => { button.click(); button.click(); });
    expect(open).toHaveBeenCalledOnce();
    await act(() => finish({threadId:"new-thread"}));
    expect(select).toHaveBeenCalledWith("new-thread");
    expect(document.querySelector("form")).toBeNull();
  });

  it("offers New conversation first in the picker even without any history", async () => {
    const host=document.createElement("div"); document.body.append(host);
    const root=createRoot(host); roots.push(root);
    const select=vi.fn(), open=vi.fn().mockResolvedValue({threadId:"from-picker"});
    const rpc={development:{list:vi.fn().mockResolvedValue([]),open}} as unknown as RpcClient;
    await act(()=>root.render(<MicoTaskTabs botId="mico" scope="picker" rpc={rpc} onSelect={select} />));
    await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    const popup=document.querySelector('[data-slot="popover-content"]')!;
    const first=popup.querySelector<HTMLButtonElement>("button")!;
    expect(first.textContent).toBe("New conversation");
    await act(()=>first.click());
    expect(open).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith("from-picker");
    expect(document.querySelector("input")).toBeNull();
  });

  it("refreshes the generated title after a message and saves a manual rename", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    let title = "";
    const list = vi.fn(async () => [{threadId:"task",title}]);
    const rename = vi.fn(async (input: {title:string}) => { title=input.title; return {threadId:"task",title}; });
    const rpc = {development:{list,rename}} as unknown as RpcClient;
    const render = (count:number) => root.render(<MicoTaskTabs botId="mico" scope="rename" taskThreadId="task" messageCount={count} rpc={rpc} onSelect={vi.fn()} />);
    await act(() => render(0));
    expect(host.querySelector('button[title="New conversation"]')).not.toBeNull();
    title="Preparar presupuesto";
    await act(() => render(1));
    expect(host.querySelector('button[title="Preparar presupuesto"]')).not.toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    await act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Rename conversation"]')!.click());
    const input=document.querySelector<HTMLInputElement>("input")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Presupuesto 2027");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
    await act(() => input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true})));
    expect(rename).toHaveBeenCalledWith({botId:"mico",taskThreadId:"task",title:"Presupuesto 2027"});
    expect(host.querySelector('button[title="Presupuesto 2027"]')).not.toBeNull();
  });

  it("closes the active tab without removing its conversation from the thread list", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    const select = vi.fn();
    const list = vi.fn().mockResolvedValue([{ threadId: "task-1", title: "Independent work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    const render = (threadId?: string) => root.render(<MicoTaskTabs botId="mico" scope="test-mico"
      taskThreadId={threadId} rpc={rpc} onSelect={select} />);
    await act(async () => render("task-1"));
    expect(list).toHaveBeenCalledWith({ botId: "mico" });
    const task = host.querySelector<HTMLButtonElement>('button[aria-current="page"]')!;
    expect(task.textContent).toBe("Independent work");
    expect(task.getAttribute("aria-current")).toBe("page");
    await act(() => task.click());
    expect(host.querySelector('input[aria-label="Conversation title"]')).not.toBeNull();
    expect(select).not.toHaveBeenCalled();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Close tab"]')!.click());
    expect(select).toHaveBeenLastCalledWith(undefined);
    await act(() => render());
    expect(host.querySelector('button[title="Independent work"]')).toBeNull();
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    const reopen = Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Independent work")!;
    await act(() => reopen.click());
    expect(select).toHaveBeenLastCalledWith("task-1");
  });

  it("discards a previous Mico's late list response after changing scope", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host); roots.push(root);
    let finish!: (rows: { threadId: string; title: string }[]) => void;
    const list = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce([{ threadId: "b-task", title: "Mico B work" }]);
    const rpc = { development: { list } } as unknown as RpcClient;
    await act(() => root.render(<MicoTaskTabs key="a" scope="test-a" botId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => root.render(<MicoTaskTabs key="b" scope="test-b" botId="b" rpc={rpc} onSelect={vi.fn()} />));
    await act(() => finish([{ threadId: "a-task", title: "Stale Mico A work" }]));
    await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    expect(document.body.textContent).toContain("Mico B work");
    expect(document.body.textContent).not.toContain("Stale Mico A work");
  });

  it("retains tab titles and open tabs during a scoped remount with a delayed network", async () => {
    const host=document.createElement("div"); document.body.append(host);
    const root=createRoot(host); roots.push(root);
    let resolveList!: (rows: {threadId:string;title:string}[])=>void;
    const list=vi.fn().mockResolvedValueOnce([{threadId:"a",title:"Existing title"}])
      .mockImplementation(()=>new Promise(resolve=>{resolveList=resolve;}));
    const open=vi.fn().mockResolvedValue({threadId:"b"});
    const rpc={development:{list,open}} as unknown as RpcClient;
    const render=(key:string,taskThreadId:string)=>root.render(<MicoTaskTabs key={key} botId="mico" scope="persist" taskThreadId={taskThreadId} rpc={rpc} onSelect={vi.fn()} />);
    await act(()=>render("a","a"));
    await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="New conversation"]')!.click());
    expect(JSON.parse(localStorage.getItem("mycellios:open-task-tabs:persist")!)).toEqual(["a","b"]);
    await act(()=>render("b","b"));
    // History is present before this new task's first list request resolves.
    await act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="Conversations"]')!.click());
    expect(document.body.textContent).toContain("Existing title");
    await act(()=>resolveList([{threadId:"a",title:"Existing title"},{threadId:"b",title:""}]));
  });

  it("edits the selected title on click, cancels with Escape, and saves on blur", async () => {
    const host=document.createElement("div");document.body.append(host);
    const root=createRoot(host);roots.push(root);
    const rename=vi.fn().mockResolvedValue({threadId:"a",title:"New name"});
    const rpc={development:{list:vi.fn().mockResolvedValue([{threadId:"a",title:"Original"}]),rename}} as unknown as RpcClient;
    await act(()=>root.render(<MicoTaskTabs botId="mico" scope="inline" taskThreadId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(()=>host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    let input=host.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(8);
    await act(()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
    expect(rename).not.toHaveBeenCalled(); expect(host.querySelector("input")).toBeNull();
    await act(()=>host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    input=host.querySelector<HTMLInputElement>("input")!;
    await act(()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"New name");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    await act(()=>input.blur());
    expect(rename).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledWith({botId:"mico",taskThreadId:"a",title:"New name"});
  });

  it("keeps a failed edit for retry and prevents duplicate submissions", async () => {
    const host=document.createElement("div");document.body.append(host);
    const root=createRoot(host);roots.push(root);
    let finish!: (value:{threadId:string;title:string})=>void;
    const rename=vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const rpc={development:{list:vi.fn().mockResolvedValue([{threadId:"a",title:"Original"}]),rename}} as unknown as RpcClient;
    await act(()=>root.render(<MicoTaskTabs botId="mico" scope="retry" taskThreadId="a" rpc={rpc} onSelect={vi.fn()} />));
    await act(()=>host.querySelector<HTMLButtonElement>('button[title="Original"]')!.click());
    const input=host.querySelector<HTMLInputElement>("input")!;
    await act(()=>{
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Retry title");
      input.dispatchEvent(new Event("input",{bubbles:true}));
    });
    const enter=()=>input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await act(()=>{enter();});
    expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(input.value).toBe("Retry title");
    await act(()=>{enter();enter();});
    expect(rename).toHaveBeenCalledTimes(2);
    await act(()=>finish({threadId:"a",title:"Retry title"}));
    expect(host.querySelector("input")).toBeNull();
  });
});

describe("readable conversation tabs",()=>{
  const tabs=Array.from({length:8},(_,index)=>({threadId:String(index),title:`Conversation ${index}`}));
  it("keeps the active conversation visible when many tabs are open",()=>{
    expect(fitConversationTabs(tabs,"1",560).map(tab=>tab.threadId)).toEqual(["1","7"]);
    expect(fitConversationTabs(tabs,"1",280).map(tab=>tab.threadId)).toEqual(["1"]);
  });
  it("shows recent tabs on the main chat and restores more only when space allows",()=>{
    expect(fitConversationTabs(tabs,undefined,560).map(tab=>tab.threadId)).toEqual(["6","7"]);
    expect(fitConversationTabs(tabs,"1",2000)).toEqual(tabs);
    expect(fitConversationTabs([],undefined,0)).toEqual([]);
    expect(fitConversationTabs(tabs,"1",0).map(tab=>tab.threadId)).toEqual(["1"]);
  });
});
