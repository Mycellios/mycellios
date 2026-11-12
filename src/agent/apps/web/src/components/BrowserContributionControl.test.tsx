// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f=vi.hoisted(()=>({owner:"one",availability:vi.fn(),bind:vi.fn(),start:vi.fn(),stop:vi.fn(),init:vi.fn(),unsubscribe:vi.fn(),listener:null as null|((value:any)=>void),snapshot:{running:false,starting:false,connection:"offline",verifiedTasks:0}}));
vi.mock("../lib/browser-contribution-availability",()=>({browserContributionAvailability:f.availability}));
vi.mock("../lib/rpc",()=>({rpc:{models:{browserContributionLink:f.bind}}}));
vi.mock("../lib/auth",()=>({authClient:{useSession:()=>({data:{user:{id:f.owner}}})}}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join("")})}));
vi.mock("@rakazo/ui-web",()=>({Button:(props:any)=><button {...props}/> }));
vi.mock("../../../../../mobile/runtime",()=>({getMobileWorkerAccountProof:()=>({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"test-worker-proof"}),initializeMobileWorker:f.init,startMobileWorker:f.start,stopMobileWorker:f.stop,getMobileWorkerSnapshot:()=>f.snapshot,subscribeMobileWorker:(fn:any)=>{f.listener=fn;fn(f.snapshot);return f.unsubscribe;}}));
import { BrowserContributionControl } from "./BrowserContributionControl";
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
function emit(running:boolean,connection="online",verifiedTasks=0){f.snapshot={running,starting:false,connection,verifiedTasks};f.listener?.(f.snapshot);}
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.clearAllMocks();f.availability.mockResolvedValue("ready");f.bind.mockResolvedValue({linked:true});f.owner="one";f.snapshot={running:false,starting:false,connection:"offline",verifiedTasks:0};f.listener=null;f.start.mockImplementation(async()=>emit(true));f.stop.mockImplementation(async()=>emit(false,"offline"));host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function mount(){await act(async()=>root.render(<BrowserContributionControl/>));}
async function click(){await act(async()=>host.querySelector("button")!.click());}
it("does not start on mount and activates/pauses in place",async()=>{await mount();expect(f.start).not.toHaveBeenCalled();expect(host.querySelector("a")).toBeNull();await click();expect(f.init).toHaveBeenCalledWith({embedded:true});expect(f.start).toHaveBeenCalledOnce();expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");expect(document.body.dataset.mycelliosContributing).toBe("true");await click();expect(f.stop).toHaveBeenCalledOnce();expect(document.body.dataset.mycelliosContributing).toBe("false");});
it("does not mark a connecting worker as contributing",async()=>{f.start.mockImplementation(async()=>emit(true,"connecting"));await mount();await click();expect(document.body.dataset.mycelliosContributing).not.toBe("true");expect(host.textContent).toContain("Checking connection");});
it("stops on account changes without resuming the next account",async()=>{await mount();await click();f.owner="two";await act(async()=>root.render(<BrowserContributionControl/>));expect(f.stop).toHaveBeenCalled();expect(f.unsubscribe).toHaveBeenCalled();expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");expect(f.start).toHaveBeenCalledOnce();});
it("clears the indicator and stops on unmount",async()=>{await mount();await click();await act(async()=>root.render(null));expect(f.stop).toHaveBeenCalled();expect(document.body.dataset.mycelliosContributing).toBe("false");});
it("shows a recoverable connection error without opening a page",async()=>{f.start.mockRejectedValue(new Error("offline"));await mount();await click();expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not connect");expect(host.querySelector("a")).toBeNull();expect(document.body.dataset.mycelliosContributing).not.toBe("true");});

it("requests a wallet refresh only when verified work advances for the current account",async()=>{
 const refresh=vi.fn();window.addEventListener("mycellios:contribution-verified",refresh);
 try {await mount();await click();expect(refresh).not.toHaveBeenCalled();
  await act(async()=>emit(true,"online",1));expect(refresh).toHaveBeenCalledOnce();
  await act(async()=>emit(true,"online",1));expect(refresh).toHaveBeenCalledOnce();
  await click();await act(async()=>emit(false,"offline",2));expect(refresh).toHaveBeenCalledOnce();
 }finally{window.removeEventListener("mycellios:contribution-verified",refresh);}
});
it("links only the active signed worker to the current account without forwarding an account token",async()=>{
 await mount();expect(f.bind).not.toHaveBeenCalled();await click();
 expect(f.bind).toHaveBeenCalledOnce();expect(f.bind).toHaveBeenCalledWith({workerId:"32cb4b44-cd2e-45d5-966e-b876f4c4dba0",token:"test-worker-proof",expectedUserId:"one"},expect.objectContaining({signal:expect.any(AbortSignal)}));
 await act(async()=>emit(true,"online",1));expect(f.bind).toHaveBeenCalledOnce();
});
it("pauses on an account failure and permits an in-place retry without inventing a balance",async()=>{
 f.bind.mockRejectedValueOnce(Object.assign(new Error("unauthorized"),{code:"UNAUTHORIZED"}));await mount();await click();
 expect(host.textContent).toContain("Your account could not be linked");expect(f.start).toHaveBeenCalledOnce();
 expect(f.stop).toHaveBeenCalledOnce();expect(document.body.dataset.mycelliosContributing).toBe("false");
 await click();expect(host.textContent).not.toContain("Your account could not be linked");expect(f.bind).toHaveBeenCalledTimes(2);
});

it("does not load or start compute when the active coordinator has no payout service",async()=>{
 f.availability.mockResolvedValueOnce("unavailable");await mount();await click();
 expect(host.textContent).toContain("Browser earnings aren't available yet");
 expect(f.init).not.toHaveBeenCalled();expect(f.start).not.toHaveBeenCalled();expect(f.bind).not.toHaveBeenCalled();
 expect(document.body.dataset.mycelliosContributing).not.toBe("true");
 await click();expect(f.start).toHaveBeenCalledOnce();expect(f.bind).toHaveBeenCalledOnce();
});
it("waits for confirmed account ownership before showing contribution or refreshing earnings",async()=>{
 let confirm!:(value:{linked:true})=>void;f.bind.mockImplementationOnce(()=>new Promise(resolve=>{confirm=resolve;}));
 await mount();await click();expect(document.body.dataset.mycelliosContributing).not.toBe("true");
 await act(async()=>confirm({linked:true}));expect(document.body.dataset.mycelliosContributing).toBe("true");
});
it("retries a transient link failure without restarting the worker or duplicating a binding",async()=>{
 vi.useFakeTimers();f.bind.mockRejectedValueOnce(Object.assign(new Error("offline"),{code:"SERVICE_UNAVAILABLE"}));
 await mount();await click();expect(f.bind).toHaveBeenCalledOnce();
 await act(async()=>{await vi.advanceTimersByTimeAsync(750);});expect(f.bind).toHaveBeenCalledTimes(2);
 expect(f.start).toHaveBeenCalledOnce();expect(document.body.dataset.mycelliosContributing).toBe("true");
 await act(async()=>emit(true,"online",1));expect(f.bind).toHaveBeenCalledTimes(2);
});
it("cancels a pending retry and ignores late success when the user pauses",async()=>{
 vi.useFakeTimers();f.bind.mockRejectedValueOnce(new Error("offline"));await mount();await click();await click();
 await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});expect(f.bind).toHaveBeenCalledOnce();
 expect(document.body.dataset.mycelliosContributing).toBe("false");
});
it("ignores an old account's late binding confirmation",async()=>{
 let confirm!:(value:{linked:true})=>void;f.bind.mockImplementationOnce(()=>new Promise(resolve=>{confirm=resolve;}));
 await mount();await click();f.owner="two";await act(async()=>root.render(<BrowserContributionControl/>));
 await act(async()=>confirm({linked:true}));expect(document.body.dataset.mycelliosContributing).toBe("false");
 expect(f.start).toHaveBeenCalledOnce();
});
