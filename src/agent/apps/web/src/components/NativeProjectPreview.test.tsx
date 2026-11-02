// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NativeProjectPreview } from "./NativeProjectPreview";
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(parts:TemplateStringsArray)=>parts.join("")})}));
afterEach(()=>{delete window.rakazoDesktop;vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});
it("keeps the native rectangle under app dialogs and detaches it on unmount",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  vi.stubGlobal("requestAnimationFrame",(fn:()=>void)=>setTimeout(fn,0));
  vi.stubGlobal("cancelAnimationFrame",clearTimeout);
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockReturnValue({x:600,y:110,width:500,height:500} as DOMRect);
  vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([{}] as any);
  const preview={show:vi.fn(async()=>{}),layout:vi.fn(async()=>{}),onChanged:vi.fn(()=>()=>{})};
  window.rakazoDesktop={preview} as any;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,20));
  await act(async()=>{root.render(<NativeProjectPreview id="page" url="http://localhost:3000/" onChanged={()=>{}}/>);await settle();});
  await act(settle);
  expect(preview.show).toHaveBeenCalledWith({id:"page",url:"http://localhost:3000/",bounds:{x:600,y:110,width:500,height:500}});
  const modal=document.createElement("div");modal.setAttribute("role","dialog");
  await act(async()=>{document.body.append(modal);await settle();});
  expect(preview.layout).toHaveBeenLastCalledWith({id:"page",bounds:null});
  await act(async()=>{modal.remove();await settle();});
  expect(preview.layout).toHaveBeenLastCalledWith({id:"page",bounds:{x:600,y:110,width:500,height:500}});
  await act(async()=>root.unmount());
  expect(preview.layout).toHaveBeenLastCalledWith({id:"page",bounds:null});
});
