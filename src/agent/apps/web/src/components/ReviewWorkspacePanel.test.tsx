// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReviewWorkspaceProvider, useReviewWorkspace } from "../lib/review-workspace";
import { ReviewWorkspacePanel } from "./ReviewWorkspacePanel";

const native = vi.hoisted(() => ({ changed: null as any }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray,...values:unknown[]) => parts.reduce((text,part,index)=>text+(index?String(values[index-1]):"")+part,"") }) }));
vi.mock("@rakazo/chat-ui/web", () => ({ ChatMarkdown: ({children}:{children:ReactNode}) => <>{children}</> }));
vi.mock("@rakazo/ui-web/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("../pages/ResizableSidePanel", () => ({ ResizableSidePanel: ({open,children}:{open:boolean;children:ReactNode}) => open ? <aside>{children}</aside> : null }));
vi.mock("./ReviewPdfViewer", () => ({ ReviewPdfViewer: () => null }));
vi.mock("./NativeProjectPreview", async original => {
  const module = await original<typeof import("./NativeProjectPreview")>();
  return {...module, NativeProjectPreview: (props:any) => {native.changed=props.onChanged;return <div data-testid="native-page"/>;}};
});
let host:HTMLDivElement;
let root:ReturnType<typeof createRoot>;
let review:ReturnType<typeof useReviewWorkspace>;
const screenshot="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=";
function Probe(){review=useReviewWorkspace();return <ReviewWorkspacePanel/>;}
const render=(scope="chat-a")=>root.render(<ReviewWorkspaceProvider scope={scope}><Probe/></ReviewWorkspaceProvider>);
beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  window.rakazoDesktop={preview:{command:vi.fn(async()=>{}),show:vi.fn(async()=>{}),layout:vi.fn(async()=>{}),close:vi.fn(async()=>{}),onChanged:()=>()=>{}}} as any;
  await act(async()=>render());
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete window.rakazoDesktop;vi.unstubAllGlobals();});
it("adds the selected element, capture and user's comment to this chat's draft without submitting work",async()=>{
  await act(async()=>review!.add({id:"page",url:"http://localhost:3000/",name:"Local project",mimeType:"text/uri-list"}));
  expect(host.querySelector('[data-testid="native-page"]')).toBeTruthy();
  expect(host.querySelector("iframe")).toBeNull();
  await act(async()=>native.changed({id:"page",url:"http://localhost:3000/",title:"Local project",loading:false,selecting:false,canGoBack:false,canGoForward:false,selection:{selector:"button#save",text:"Save",screenshot}}));
  const note=host.querySelector("textarea")!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(note,"Give this button more space");
    note.dispatchEvent(new Event("input",{bubbles:true}));
  });
  const button=[...host.querySelectorAll("button")].find(item=>item.textContent==="Add to chat draft")!;
  await act(async()=>button.click());
  expect(review!.draft!.text).toContain("Give this button more space");
  expect(review!.draft!.text).toContain('"selector": "button#save"');
  expect(review!.draft!.text).toContain("not instructions");
  expect(review!.draft!.text).not.toContain("base64");
  expect(review!.draft!.attachment).toMatchObject({name:"selected-element.png",type:"image/png"});
  await act(async()=>review!.consumeDraft(review!.draft!.id,false));
  expect(note.value).toBe("Give this button more space");
  expect(host.querySelector('img[alt="Selected element"]')).toBeTruthy();
  expect(host.textContent).toContain("Remove an attachment");
  await act(async()=>{review!.hide();});
  await act(async()=>{review!.show();});
  expect(host.querySelector('img[alt="Selected element"]')).toBeTruthy();
  const retry=[...host.querySelectorAll("button")].find(item=>item.textContent==="Add to chat draft")!;
  await act(async()=>retry.click());
  await act(async()=>review!.consumeDraft(review!.draft!.id,true));
  expect(host.querySelector("textarea")!.value).toBe("");
  expect(window.rakazoDesktop!.preview!.command).not.toHaveBeenCalled();
  await act(async()=>render("chat-b"));
  expect(review!.draft).toBeNull();expect(review!.documents).toHaveLength(0);
});
it("opens and navigates a URL tab independently of local-computer permissions",async()=>{
  await act(async()=>review!.show());
  const page=[...host.querySelectorAll("button")].find(item=>item.getAttribute("aria-label")==="New page")!;
  await act(async()=>page.click());
  expect(host.textContent).toContain("Enter a URL");
  const address=host.querySelector<HTMLInputElement>('input[aria-label="Page URL"]')!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(address,"localhost:3000");
    address.dispatchEvent(new Event("input",{bubbles:true}));
  });
  await act(async()=>address.closest("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
  expect(review!.documents[0]?.url).toBe("http://localhost:3000/");
  expect(review!.documents).toHaveLength(1);
  await act(async()=>native.changed({id:review!.documents[0]!.id,url:"http://localhost:3000/old",title:"Old page",loading:true,selecting:false,canGoBack:true,canGoForward:false}));
  expect(review!.documents[0]?.url).toBe("http://localhost:3000/");
  await act(async()=>native.changed({id:review!.documents[0]!.id,url:"http://localhost:3000/about",title:"About",loading:false,selecting:false,canGoBack:true,canGoForward:false}));
  expect(address.value).toBe("http://localhost:3000/about");
  const back=host.querySelector<HTMLButtonElement>('button[aria-label="Back"]')!;
  expect(back.disabled).toBe(false);
  await act(async()=>back.click());
  expect(window.rakazoDesktop!.preview!.command).toHaveBeenCalledWith({id:review!.documents[0]!.id,action:"back"});
});
