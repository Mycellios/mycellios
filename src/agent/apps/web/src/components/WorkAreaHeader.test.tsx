// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,it,vi} from "vitest";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join("")})}));
import {WorkAreaHeader} from "./WorkAreaHeader";
it("switches views and preserves all secondary actions without duplicating settings buttons",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
 const props={active:"computer" as const,onBrowser:vi.fn(),onComputer:vi.fn(),onFiles:vi.fn(),onSettings:vi.fn(),onComputerSettings:vi.fn(),onVoice:vi.fn(),onClose:vi.fn()};
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 try {
 await act(async()=>root.render(<WorkAreaHeader {...props}/>));
 const buttons=[...host.querySelectorAll("button")];
 expect(buttons.find(b=>b.textContent==="Computer")?.getAttribute("aria-pressed")).toBe("true");
 await act(async()=>buttons.find(b=>b.textContent==="Browser")!.click());expect(props.onBrowser).toHaveBeenCalledOnce();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Close workspace"]')!.click());expect(props.onClose).toHaveBeenCalledOnce();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="More tools"]')!.click());
 for(const [label,callback] of [["Open library",props.onFiles],["Agent settings",props.onSettings],["Computer settings",props.onComputerSettings],["Open voice",props.onVoice]] as const){
   if(!document.querySelector('[role="menu"]')) await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="More tools"]')!.click());
   const item=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(m=>m.textContent===label)!;
   expect(item).toBeDefined();await act(async()=>item.click());expect(callback).toHaveBeenCalledOnce();
 }
 }finally{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it("does not offer a computer view for a group without one",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);const host=document.createElement("div");const root=createRoot(host);
 try{await act(async()=>root.render(<WorkAreaHeader active="browser" onBrowser={()=>{}} onFiles={()=>{}} onSettings={()=>{}} onClose={()=>{}}/>));expect([...host.querySelectorAll("button")].some(b=>b.textContent==="Computer")).toBe(false);}
 finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
