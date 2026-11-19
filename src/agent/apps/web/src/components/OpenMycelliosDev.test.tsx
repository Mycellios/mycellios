// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {beforeEach,afterEach,expect,it,vi} from "vitest";
import {OpenMycelliosDev} from "./OpenMycelliosDev";
const state=vi.hoisted(()=>({enabled:true,open:vi.fn(),connect:vi.fn(),native:true,dev:false}));
vi.mock("../lib/developer-mode",()=>({useDeveloperMode:()=>[state.enabled,vi.fn()]}));
vi.mock("../lib/desktop",()=>({connectThisComputer:state.connect,desktopBridge:()=>state.native?{development:{open:state.open,isDevelopment:state.dev,status:(globalThis as any).__status,stop:(globalThis as any).__stop}}:undefined}));
vi.mock("@lingui/react/macro",()=>({Trans:({children}:{children:string})=>children,useLingui:()=>({t:(parts:TemplateStringsArray)=>parts.join("")})}));
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();state.enabled=true;state.native=true;state.dev=false;state.open.mockResolvedValue({opened:true});state.connect.mockResolvedValue(undefined);(globalThis as any).__status=undefined;(globalThis as any).__stop=undefined;host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=()=>act(()=>root.render(<OpenMycelliosDev botId="mico"/>));
it("is absent outside developer mode, browser-only sessions and Dev itself",async()=>{
  state.enabled=false;await render();expect(host.querySelector("button")).toBeNull();
  state.enabled=true;state.native=false;await render();expect(host.querySelector("button")).toBeNull();
  state.native=true;state.dev=true;await render();expect(host.querySelector("button")).toBeNull();
});
it("connects the current Mico before opening the separate application",async()=>{
  await render();await act(async()=>host.querySelector("button")!.click());
  expect(state.connect).toHaveBeenCalledWith("mico");expect(state.open).toHaveBeenCalledWith("mico");
  expect(state.connect.mock.invocationCallOrder[0]).toBeLessThan(state.open.mock.invocationCallOrder[0]!);
});
it("does not open Dev when local computer consent is denied",async()=>{
  state.connect.mockRejectedValue(Error("Permission denied"));await render();await act(async()=>host.querySelector("button")!.click());
  expect(state.open).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')?.textContent).toBe("Permission denied");
});
it("coalesces clicks while preparing and displays a startup failure",async()=>{
  let finish!:(value:{opened:boolean;error:string})=>void;state.open.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  await render();await act(async()=>{host.querySelector("button")!.click();host.querySelector("button")!.click();});
  expect(state.open).toHaveBeenCalledTimes(1);expect(host.querySelector("button")?.disabled).toBe(true);
  await act(()=>finish({opened:false,error:"Could not start"}));expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not start");expect(host.querySelector("button")?.disabled).toBe(false);
});
it("shows the native launch phase, including one started before this button mounted",async()=>{
  const status=vi.fn().mockResolvedValue({state:"preparing",phase:"installing",startedAt:Date.now()-65000,logs:"added 12 packages"});
  (globalThis as any).__status=status;
  await render();await act(async()=>{});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="open-mycellios-dev"]')?.disabled).toBe(true);
  expect(host.textContent).toContain("Installing dependencies…");expect(host.textContent).toMatch(/1:0[0-9]/);
  status.mockResolvedValue({state:"stopped",logs:""});
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1600));});
  expect(host.querySelector<HTMLButtonElement>('[data-testid="open-mycellios-dev"]')?.disabled).toBe(false);expect(host.textContent).toContain("Open Mycellios Dev");
});
it("stops a running stack and shows its logs on request",async()=>{
  const stop=vi.fn().mockResolvedValue({stopped:true});
  (globalThis as any).__stop=stop;
  (globalThis as any).__status=vi.fn().mockResolvedValue({state:"running",logs:"Dev web ready"});
  await render();await act(async()=>{});
  expect(host.textContent).toContain("Mycellios Dev is running");
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Mycellios Dev logs"]')!.click());
  expect(host.querySelector('[data-testid="mycellios-dev-logs"]')?.textContent).toBe("Dev web ready");
  await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Stop Mycellios Dev"]')!.click());
  expect(stop).toHaveBeenCalledTimes(1);expect(host.textContent).toContain("Open Mycellios Dev");
});
it("does not report a launch the owner stopped as a failure",async()=>{
  state.open.mockResolvedValue({opened:false,stopped:true});
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid="open-mycellios-dev"]')!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
