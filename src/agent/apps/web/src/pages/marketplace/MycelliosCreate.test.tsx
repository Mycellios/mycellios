// @vitest-environment jsdom
import {act} from "react";
import {createRoot} from "react-dom/client";
import {afterEach,it,expect,vi} from "vitest";
const {call}=vi.hoisted(()=>({call:vi.fn()}));
vi.mock("../../lib/rpc",()=>({rpc:{models:{mycelliosMedia:call}}}));
import {MycelliosCreate} from "./MycelliosCreate";
let root:ReturnType<typeof createRoot>,node:HTMLDivElement;
afterEach(()=>{if(root)act(()=>root.unmount());node?.remove();call.mockReset();sessionStorage.clear();vi.useRealTimers();});
async function mount(){vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);node=document.createElement("div");document.body.append(node);root=createRoot(node);await act(async()=>root.render(<MycelliosCreate onBack={()=>{}}/>));}
it("does not submit, create checkout sessions or fabricate models when the managed service is off",async()=>{
 call.mockRejectedValue(new Error("Servicio en preparación. No se ha gastado ningún crédito."));await mount();
 expect(node.textContent).toContain("No se ha gastado ningún crédito");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});
it("loads the real service catalog without spending or preselecting a paid confirmation",async()=>{
 call.mockResolvedValue({viewer:"alice",data:[{id:"mycellios/media/image",name:"Image",modality:"image",voices:[],durations:[],maximumCreditsMicrounits:1040000}]});await mount();
 expect(node.textContent).toContain("Ver precio");expect(node.textContent).not.toContain("Crear y usar créditos");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});

const imageCatalog={viewer:"alice",data:[{id:"mycellios/media/image",name:"Image",modality:"image",voices:[],durations:[],maximumCreditsMicrounits:1040000}]};
async function click(text:string){await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent===text)!.click());}
async function enterPrompt(text:string){await act(async()=>{const field=node.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));});}

it("quotes before explicit purchase and retains the owned recovery key before execute",async()=>{
 let savedAtExecute:string|null=null;
 call.mockImplementation(async(v)=>{
  if(v.action==="models")return imageCatalog;
  if(v.action==="quote")return {maximumMicrounits:1040000,token:"signed-quote"};
  if(v.action==="execute"){savedAtExecute=sessionStorage.getItem("mycellios-create-alice");return {status:"completed",response:{kind:"image",mycellios:{creditsMicrounits:1040000}}};}
  throw new Error("unexpected action");
 });
 await mount();await enterPrompt("A tree");await click("Ver precio");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models","quote"]);
 expect(node.textContent).toContain("Incluye el 4 %");
 await click("Crear y usar créditos");
 const purchase=call.mock.calls.find(([v])=>v.action==="execute")![0];
 expect(purchase.key).toBe(savedAtExecute);
 expect(JSON.parse(purchase.payload)).toEqual({request:{model:"mycellios/media/image",kind:"image",prompt:"A tree"},quoteToken:"signed-quote"});
 expect(sessionStorage.getItem("mycellios-create-alice")).toBeNull();
 expect(node.textContent).toContain("1,04 créditos utilizados");
});

it("recovers a pending purchase via status without another create or spending",async()=>{
 vi.useFakeTimers();const key="a1234567-1234-1234-1234-123456789abc";sessionStorage.setItem("mycellios-create-alice",key);
 call.mockImplementation(async(v)=>v.action==="models"?imageCatalog:{status:"completed",response:{text:"Recovered",mycellios:{creditsMicrounits:1040000}}});
 await mount();await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models","status"]);
 expect(JSON.parse(call.mock.calls[1]![0].payload)).toEqual({idempotencyKey:key});
 expect(node.textContent).toContain("Recovered");expect(sessionStorage.getItem("mycellios-create-alice")).toBeNull();
});

it("keeps recharge separate from media creation and does not open or pay the checkout",async()=>{
 call.mockImplementation(async(v)=>v.action==="models"?imageCatalog:{url:"https://checkout.stripe.com/c/pay_fixture"});
 await mount();await click("Recargar 5 créditos · 5 USD");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models","checkout"]);
 expect(JSON.parse(call.mock.calls[1]![0].payload)).toEqual({dollars:5});
 expect(node.querySelector('a[href="https://checkout.stripe.com/c/pay_fixture"]')?.textContent).toBe("Continuar al pago");
 expect(node.textContent).not.toContain("Tu resultado");
});
