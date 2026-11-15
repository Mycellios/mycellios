// @vitest-environment jsdom
import {act,type ReactNode} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,expect,it,vi} from "vitest";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(parts:TemplateStringsArray)=>parts.join("")})}));
vi.mock("../../lib/desktop",()=>({desktopDragClass:()=>""}));
vi.mock("./HostedWebs",()=>({HostedWebs:vi.fn(()=> <textarea aria-label="App draft" defaultValue="Unsaved draft"/>)}));
vi.mock("../PluginsOverlay",()=>({PluginsOverlay:()=>null}));
vi.mock("./AgentsMarketplace",()=>({AgentsMarketplace:()=>null}));
vi.mock("./SkillsMarketplace",()=>({SkillsMarketplace:()=>null}));
import {MarketplaceWorkspace} from "./MarketplaceWorkspace";
import {HostedWebs} from "./HostedWebs";
import type {MarketplaceTab} from "./catalog";
const onTab=vi.fn();
let root:ReturnType<typeof createRoot>|undefined,host:HTMLDivElement;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;host?.remove();localStorage.clear();vi.restoreAllMocks();vi.clearAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function mount(storeAvailable=true,tab:MarketplaceTab="mycellios-apps"){vi.stubEnv("VITE_MYCELLIOS_HIFA_STORE",storeAvailable?"true":"false");vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<MarketplaceWorkspace tab={tab} onTab={onTab} scope="owner-space" bots={[]} onExit={()=>{}} onMcp={()=>{}} onCreated={()=>{}} onOpenBot={()=>{}} onBotsChanged={async()=>{}} onCreateBot={()=>{}}/>));}
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
it("keeps Hifa Store visible but disabled, including direct Store links, without mounting apps",async()=>{
 await mount(false);
 const store=Array.from(host.querySelectorAll<HTMLButtonElement>("aside button")).find(button=>button.textContent?.includes("Hifa Store"))!;
 expect(store.disabled).toBe(true);expect(store.textContent).toContain("Coming soon");
 await act(async()=>store.click());expect(onTab).not.toHaveBeenCalled();
 expect(host.querySelector("h1")?.textContent).toBe("Hifa Store");
 expect(host.querySelector(".rk-market-coming-soon-status")?.textContent).toBe("Coming soon");
 expect(HostedWebs).not.toHaveBeenCalled();expect(host.querySelector("textarea")).toBeNull();
});
it("keeps the other Marketplace sections available while the Store is paused",async()=>{
 await mount(false,"apps");
 const buttons=Array.from(host.querySelectorAll<HTMLButtonElement>("aside button"));
 for(const label of ["Integrations","Micos","Skills"]){const button=buttons.find(item=>item.textContent===label)!;expect(button.disabled).toBe(false);await act(async()=>button.click());}
 expect(onTab.mock.calls.map(([tab])=>tab)).toEqual(["apps","agents","skills"]);
 expect(host.querySelector(".rk-market-coming-soon")).toBeNull();expect(HostedWebs).not.toHaveBeenCalled();
});
