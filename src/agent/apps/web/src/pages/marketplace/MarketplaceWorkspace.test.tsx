// @vitest-environment jsdom
import {act,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(parts:TemplateStringsArray)=>parts.join("")})}));
vi.mock("../../lib/desktop",()=>({desktopDragClass:()=>""}));
vi.mock("./HostedWebs",()=>({HostedWebs:()=> <textarea aria-label="App draft" defaultValue="Unsaved draft"/>}));
vi.mock("../PluginsOverlay",()=>({PluginsOverlay:()=>null}));
vi.mock("./AgentsMarketplace",()=>({AgentsMarketplace:()=>null}));
vi.mock("./SkillsMarketplace",()=>({SkillsMarketplace:()=>null}));
import {MarketplaceWorkspace} from "./MarketplaceWorkspace";
let root:ReturnType<typeof createRoot>|undefined,host:HTMLDivElement;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;host?.remove();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<MarketplaceWorkspace tab="mycellios-apps" onTab={()=>{}} scope="owner-space" bots={[]} onExit={()=>{}} onMcp={()=>{}} onCreated={()=>{}} onOpenBot={()=>{}} onBotsChanged={async()=>{}} onCreateBot={()=>{}}/>));}
const toggle=()=>host.querySelector<HTMLButtonElement>("button[aria-controls]")!;
it("frees the entire menu without unmounting the app, losing its draft or moving keyboard focus",async()=>{
 await mount();const draft=host.querySelector("textarea")!;draft.value="Still editing";toggle().focus();
 expect(host.querySelector("aside")!.hidden).toBe(false);await act(async()=>toggle().click());
 expect(host.querySelector("aside")!.hidden).toBe(true);expect(toggle().getAttribute("aria-expanded")).toBe("false");
 expect(document.activeElement).toBe(toggle());expect(host.querySelector("textarea")).toBe(draft);expect(draft.value).toBe("Still editing");
 await act(async()=>toggle().click());expect(host.querySelector("aside")!.hidden).toBe(false);expect(draft.value).toBe("Still editing");
});
it("remembers a collapsed menu after leaving and reopening Marketplace",async()=>{
 await mount();await act(async()=>toggle().click());act(()=>root!.unmount());root=undefined;host.remove();await mount();
 expect(host.querySelector("aside")!.hidden).toBe(true);expect(toggle().getAttribute("aria-label")).toBe("Expand Marketplace menu");
});
it("keeps the collapse control usable when browser storage is blocked",async()=>{
 vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked");});vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
 await mount();await act(async()=>toggle().click());expect(host.querySelector("aside")!.hidden).toBe(true);
 await act(async()=>toggle().click());expect(host.querySelector("aside")!.hidden).toBe(false);
});
