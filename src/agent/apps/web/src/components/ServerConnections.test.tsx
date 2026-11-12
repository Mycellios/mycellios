// @vitest-environment jsdom
import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ bridge: null as any, owner: "alice" as string | null, read: vi.fn(), save: vi.fn() }));
vi.mock("../lib/desktop",()=>({desktopBridge:()=>f.bridge}));
vi.mock("../lib/query",()=>({useQueryUserId:()=>f.owner}));
vi.mock("../lib/rpc",()=>({rpc:{notifications:{settings:f.read,saveSettings:f.save}}}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join("")})}));
vi.mock("./ServerConnectionSettings",()=>({ServerConnectionSettings:(p:any)=>{const[draft,setDraft]=useState("");return <div role="dialog"><span>{p.server.name}</span><input aria-label="identity draft" value={draft} onChange={e=>setDraft(e.target.value)}/><button onClick={()=>void p.onSave({name:"My team",color:"#334455"}).then(p.onClose)}>Save identity</button></div>;}}));
vi.mock("@rakazo/ui-web",()=>{
 const Box=({children}: {children?:ReactNode})=><div>{children}</div>;
 const Item=({children,onClick,disabled,"aria-label":label}:ComponentProps<"button">)=><button disabled={disabled} aria-label={label} onClick={onClick}>{children}</button>;
 return {Button:Item,Input:(p:ComponentProps<"input">)=><input {...p}/>,Dialog:Box,DialogContent:Box,DialogTitle:Box,Popover:Box,PopoverContent:Box,PopoverTrigger:Item,
  DropdownMenu:Box,DropdownMenuContent:Box,DropdownMenuItem:Item,DropdownMenuLabel:Box,DropdownMenuSeparator:()=>null,DropdownMenuSub:Box,DropdownMenuSubContent:Box,DropdownMenuSubTrigger:Item,DropdownMenuTrigger:Item,
  DropdownMenuRadioGroup:Box,DropdownMenuRadioItem:Item};
});
import { ServerConnectionName, ServerConnections } from "./ServerConnections";
import { ServerConnectionDialogs } from "./ServerConnectionDialogs";
import { closeServerDialog } from "../lib/server-dialogs";
import { readBrowserServers } from "../lib/server-connections";
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();localStorage.clear();closeServerDialog();f.bridge=null;f.owner="alice";
 f.read.mockResolvedValue({level:"all",previews:false,bots:{mico:"off"},mutedUntil:null}); f.save.mockImplementation(async value=>value);
 host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=async(node:ReactNode=<ServerConnections/>)=>act(async()=>{root.render(<>{node}<ServerConnectionDialogs ownerId={f.owner}/></>);});
async function click(text:string) { const button=[...host.querySelectorAll("button")].find(el=>el.textContent===text||el.getAttribute("aria-label")===text);expect(button).toBeTruthy();await act(async()=>button!.click()); }
it("works in a browser without a native bridge and exposes a real current connection",async()=>{
 await render(); expect(host.textContent).toContain("Servers");expect(host.textContent).toContain("Server settings");expect(f.read).not.toHaveBeenCalled();
 await click("Server settings"); expect(host.querySelector('[role=dialog]')).not.toBeNull();
});
it("does not silently use a browser directory after native loading fails and offers retry",async()=>{
 const list=vi.fn().mockRejectedValueOnce(Error("offline")).mockResolvedValue({servers:[{mode:"existing",serverUrl:"https://a.test",name:"A"}],current:"https://a.test"});
 f.bridge={servers:{list,manage:vi.fn()}};await render();expect(host.querySelector('[role=alert]')?.textContent).toContain("Could not load servers");
 await click("Retry");expect(host.textContent).toContain("A");expect(list).toHaveBeenCalledTimes(2);
});
it("retains native task/call/draft guards on adding and selecting a server",async()=>{
 const manage=vi.fn().mockRejectedValue(Error("active work"));f.bridge={servers:{list:vi.fn(async()=>({servers:[],current:null})),manage}};
 await render();await click("Add a server");expect(manage).toHaveBeenCalledWith(undefined);expect(host.querySelector('[role=alert]')?.textContent).toContain("connection has not changed");
});
it("saves native identity through the dedicated bridge and refreshes the display",async()=>{
 const updateIdentity=vi.fn(async()=>{}), list=vi.fn(async()=>({servers:[{mode:"existing",serverUrl:"https://a.test",name:"A"}],current:"https://a.test"}));
 f.bridge={servers:{list,manage:vi.fn(),updateIdentity}};await render();await click("Server settings");await click("Save identity");
 expect(updateIdentity).toHaveBeenCalledWith("https://a.test",{name:"My team",color:"#334455"});expect(list.mock.calls.length).toBeGreaterThan(1);
});
it("persists browser identity and updates every mounted current-name consumer",async()=>{
 await render(<><ServerConnectionName fallback="Personal"/><ServerConnections/></>);await click("Server settings");await click("Save identity");
 expect(host.textContent).toContain("My team");expect(readBrowserServers(location.origin)[0]?.name).toBe("My team");
});
it("does not read or change another server's notification settings",async()=>{
 f.bridge={servers:{list:vi.fn(async()=>({servers:[{mode:"existing",serverUrl:"https://a.test",name:"A"},{mode:"existing",serverUrl:"https://b.test",name:"B"}],current:"https://a.test"})),manage:vi.fn()}};
 await render();expect(host.querySelectorAll("button").length).toBeGreaterThan(0);expect(f.read).not.toHaveBeenCalled();
 expect([...host.querySelectorAll("button")].filter(el=>el.textContent==="For 1 hour")).toHaveLength(1);
 await click("For 1 hour");expect(f.save).toHaveBeenCalledWith(expect.objectContaining({bots:{mico:"off"},level:"all",mutedUntil:expect.any(String)}));
});
it("does not save an old account's settings after the signed-in account changes",async()=>{
 let resolve!:(value:unknown)=>void;f.read.mockReturnValue(new Promise(r=>{resolve=r;}));await render();await click("For 1 hour");
 f.owner="bob";await render();await act(async()=>resolve({level:"all",previews:false,bots:{},mutedUntil:null}));expect(f.save).not.toHaveBeenCalled();
});
it("supports an indefinite mute without losing the previous level or Mico overrides",async()=>{
 await render();await click("Until I turn it back on");expect(f.save).toHaveBeenCalledWith({level:"all",previews:false,bots:{mico:"off"},mutedUntil:"9999-12-31T23:59:59.999Z"});
 await click("Resume notifications");expect(f.save).toHaveBeenLastCalledWith(expect.objectContaining({level:"all",bots:{mico:"off"},mutedUntil:null}));
});
it("opens an inactive browser server in a separate origin with no opener or account data",async()=>{
 localStorage.setItem("mycellios.servers.v1",JSON.stringify([{serverUrl:"https://b.test/agent",name:"B"}]));const open=vi.spyOn(window,"open").mockReturnValue(null);
 await render();await click("Open in a new tab");expect(open).toHaveBeenCalledWith("https://b.test/agent/app","_blank","noopener,noreferrer");
});
it("keeps notification failures visible and does not report a successful change",async()=>{
 f.read.mockRejectedValue(Error("offline"));await render();await click("For 15 minutes");expect(f.save).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).not.toBeNull();
});
it("preserves the open dialog and its unsaved draft when responsive navigation unmounts",async()=>{
 await render();await click("Server settings");const input=host.querySelector<HTMLInputElement>('[aria-label="identity draft"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"Unsaved team");input.dispatchEvent(new Event("input",{bubbles:true}));});
 await render(<span>Mobile navigation</span>);expect(host.querySelector('[role=dialog]')).not.toBeNull();expect(host.querySelector<HTMLInputElement>('[aria-label="identity draft"]')?.value).toBe("Unsaved team");
});
it("closes another account's open server dialog immediately on account change",async()=>{
 await render();await click("Server settings");f.owner="bob";await render();expect(host.querySelector('[role=dialog]')).toBeNull();
});
