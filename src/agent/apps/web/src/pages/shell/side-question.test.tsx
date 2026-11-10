// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray,...values:unknown[]) => parts.reduce((s,part,i)=>s+part+(values[i]??""),""), i18n:{locale:"en"} }) }));
vi.mock("@rakazo/chat-ui/web", () => ({ ChatMarkdown: ({children}:{children:string}) => <div>{children}</div> }));
import { SideQuestion } from "./side-question";
const available=vi.fn(), ask=vi.fn(), close=vi.fn();
const rpc={threads:{sideQuestionAvailable:available,sideQuestion:ask}} as unknown as RpcClient;
let root:Root, container:HTMLDivElement, props:ComponentProps<typeof SideQuestion>;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true); available.mockReset().mockResolvedValue({available:true}); ask.mockReset().mockResolvedValue({answer:"Independent answer"}); close.mockClear(); Element.prototype.scrollIntoView??=()=>{}; container=document.createElement("div");document.body.append(container);root=createRoot(container);props={rpc,botId:"bot",taskThreadId:"private-thread",name:"Mico",color:"",active:true,append:{id:"first",text:""},onClose:close};});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(p:Partial<typeof props>={}){props={...props,...p};await act(async()=>root.render(<SideQuestion {...props}/>));}
function field(){return container.querySelector<HTMLTextAreaElement>('textarea')!;}
async function type(text:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field(),text);field().dispatchEvent(new Event("input",{bubbles:true}));});}
async function send(){await act(async()=>container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
it("opens as a resizable side panel with an empty state and an independent composer",async()=>{
 await render();expect(container.querySelector('[data-panel="side-question"]')).not.toBeNull();expect(container.querySelector('[role="dialog"]')).toBeNull();expect(container.textContent).toContain("Nothing here goes back to the chat");expect(ask).not.toHaveBeenCalled();
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Expand panel"]')!.click());expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Close side question"]')!.click());expect(close).toHaveBeenCalledOnce();
});
it("keeps the pending question visible, allows a next draft and sends follow-ups only to the scoped aside RPC",async()=>{
 let resolve!:(v:{answer:string})=>void;ask.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await render();await type("First question");await send();
 expect(container.textContent).toContain("First question");expect(field().disabled).toBe(false);expect(field().value).toBe("");await type("Next question");
 await act(async()=>resolve({answer:"First answer"}));expect(field().value).toBe("Next question");await send();
 expect(ask.mock.calls[1]![0]).toMatchObject({botId:"bot",taskThreadId:"private-thread",question:"Next question",earlier:[{question:"First question",answer:"First answer"}]});
});
it("restores a failed question before newer draft text without resending automatically",async()=>{
 let reject!:(error:Error)=>void;ask.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));await render();await type("Original question");await send();await type("New draft");
 await act(async()=>reject(new Error("Provider unavailable")));expect(field().value).toBe("Original question\nNew draft");expect(container.querySelector('[role="alert"]')).not.toBeNull();expect(ask).toHaveBeenCalledOnce();
});
it("hides without losing a pending exchange and aborts it only when its owner closes",async()=>{
 let resolve!:(v:{answer:string})=>void;ask.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await render();await type("Owned question");await send();const signal=ask.mock.calls[0]![1].signal as AbortSignal;
 await render({active:false});expect(signal.aborted).toBe(false);expect(container.textContent).toBe("");
 await act(async()=>resolve({answer:"Answer retained while hidden"}));await render({active:true});expect(container.textContent).toContain("Answer retained while hidden");
 ask.mockImplementationOnce(()=>new Promise(()=>{}));await type("Pending question");await send();const pending=ask.mock.calls[1]![1].signal as AbortSignal;
 await act(async()=>root.render(null));expect(pending.aborted).toBe(true);
});
it("appends an incoming draft once and respects the send-key preference",async()=>{
 await render({append:{id:"one",text:"Transferred"},enterToSend:false});await render();expect(field().value).toBe("Transferred");
 await render({append:{id:"two",text:"More"}});expect(field().value).toBe("Transferred\nMore");
 await act(async()=>field().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));expect(ask).not.toHaveBeenCalled();
 await act(async()=>field().dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",ctrlKey:true,bubbles:true})));expect(ask).toHaveBeenCalledOnce();
});
it("keeps the visible conversation while bounding follow-up context to eight exchanges",async()=>{
 await render();for(let i=0;i<10;i++){await type(`Question ${i}`);await send();}
 expect(container.textContent).toContain("Question 0");expect(container.textContent).toContain("Question 9");expect(ask.mock.calls[9]![0].earlier).toHaveLength(8);
});
