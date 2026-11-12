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
 expect(node.textContent).not.toContain("Recargar 5 créditos");
 expect(node.querySelector("h1")?.textContent).toBe("Estudio IA");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});
it("loads the real service catalog without spending or preselecting a paid confirmation",async()=>{
 call.mockResolvedValue({viewer:"alice",data:[{id:"mycellios/media/image",name:"Image",modality:"image",voices:[],durations:[],maximumCreditsMicrounits:1040000}]});await mount();
 expect(node.textContent).toContain("Ver precio");expect(node.textContent).not.toContain("Crear y usar créditos");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});

it("explains a disabled service instead of reporting a loading failure",async()=>{
 call.mockRejectedValue(Object.assign(new Error("disabled"),{code:"PRECONDITION_FAILED"}));await mount();
 expect(node.textContent).toContain("Estudio IA aún no está activado");
 expect(node.querySelector('[role="alert"]')).toBeNull();
 expect(node.textContent).not.toContain("Recargar 5 créditos");
 expect(node.querySelector('button[aria-label="Volver a Hifa Store"]')).not.toBeNull();
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});
it("recovers a catalog outage through a read-only retry",async()=>{
 call.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(imageCatalog);await mount();
 expect(node.textContent).toContain("No podemos cargar los modelos ahora");
 await click("Reintentar");
 expect(node.textContent).toContain("Ver precio");
 expect(node.textContent).not.toContain("No podemos cargar los modelos ahora");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models","models"]);
});
it("explains a missing account connection without offering a purchase",async()=>{
 call.mockRejectedValue(Object.assign(new Error("unauthorized"),{code:"UNAUTHORIZED"}));await mount();
 expect(node.textContent).toContain("Conecta tu cuenta de Mycellios");
 expect(node.textContent).not.toContain("Recargar 5 créditos");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models"]);
});

const imageCatalog={viewer:"alice",data:[{id:"mycellios/media/image",name:"Image",modality:"image",voices:[],durations:[],maximumCreditsMicrounits:1040000}]};
async function click(text:string){await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent===text)!.click());}
async function enterPrompt(text:string){await act(async()=>{const field=node.querySelector("textarea")!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,text);field.dispatchEvent(new Event("input",{bubbles:true}));});}
async function select(label:string,value:string){await act(async()=>{const field=[...node.querySelectorAll("label")].find(v=>v.textContent?.startsWith(label))!.querySelector("select")!;field.value=value;field.dispatchEvent(new Event("change",{bubbles:true}));});}

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
it("quotes the selected voice and duration instead of always using the first option",async()=>{
 call.mockImplementation(async(v)=>v.action==="models"?{viewer:"alice",data:[{...imageCatalog.data[0],id:"voice",modality:"speech",voices:["one","two"]},{...imageCatalog.data[0],id:"video",modality:"video",durations:[3,8]}]}:{token:"q",maximumMicrounits:100});
 await mount();await enterPrompt("Hola");await select("Voz","two");await click("Ver precio");
 expect(JSON.parse(call.mock.calls.at(-1)![0].payload)).toMatchObject({voice:"two"});expect(call.mock.calls.at(-1)![0].expectedUserId).toBe("alice");
 await select("Qué quieres crear","video");await select("Duración","8");expect(node.textContent).not.toContain("Crear y usar créditos");await click("Ver precio");
 expect(JSON.parse(call.mock.calls.at(-1)![0].payload)).toMatchObject({duration:8});
});
it("collects each batch line and rerank document without automatic execution",async()=>{
 call.mockImplementation(async(v)=>v.action==="models"?{viewer:"alice",data:[{...imageCatalog.data[0],id:"batch",modality:"batch"},{...imageCatalog.data[0],id:"rank",modality:"rerank"}]}:{token:"q",maximumMicrounits:100});
 await mount();await enterPrompt("uno\ndos");await click("Ver precio");expect(JSON.parse(call.mock.calls.at(-1)![0].payload)).toMatchObject({prompts:["uno","dos"]});
 await select("Qué quieres crear","rank");await enterPrompt("consulta");
 await act(async()=>{const field=node.querySelectorAll("textarea")[1]!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"a\nb");field.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Ver precio");expect(JSON.parse(call.mock.calls.at(-1)![0].payload)).toMatchObject({prompt:"consulta",documents:["a","b"]});expect(call.mock.calls.some(([v])=>v.action==="execute")).toBe(false);
});
it("requires explicit confirmation for a zero-Credit model",async()=>{
 call.mockImplementation(async(v)=>v.action==="models"?imageCatalog:v.action==="quote"?{token:"zero",maximumMicrounits:0}:{status:"completed",response:{mycellios:{creditsMicrounits:0}}});
 await mount();await enterPrompt("Hola");await click("Ver precio");expect(node.textContent).toContain("Gratis");expect(node.textContent).not.toContain("Crear y usar créditos");
 expect(call.mock.calls.map(([v])=>v.action)).toEqual(["models","quote"]);await click("Crear gratis");expect(node.textContent).toContain("0 créditos utilizados");
});
it("reuses the same purchase key after insufficient balance instead of duplicating an uncertain request",async()=>{
 let creates=0;call.mockImplementation(async(v)=>v.action==="models"?imageCatalog:v.action==="quote"?{token:"q",maximumMicrounits:100}:v.action==="execute"?(++creates===1?{status:"not_submitted",code:"insufficient_contribution_credits"}:{status:"completed",response:{mycellios:{creditsMicrounits:100}}}):{});
 await mount();await enterPrompt("Hola");await click("Ver precio");await click("Crear y usar créditos");expect(node.textContent).toContain("No tienes créditos suficientes");
 await click("Ver precio");await click("Crear y usar créditos");const keys=call.mock.calls.filter(([v])=>v.action==="execute").map(([v])=>v.key);expect(keys[0]).toBe(keys[1]);
});

it("quotes a text evaluation with a separate state and displays an honest refusal",async()=>{
 call.mockImplementation(async(v)=>v.action==="models"?{viewer:"alice",data:[{...imageCatalog.data[0],id:"decision",modality:"decisions"}]}:v.action==="quote"?{token:"q",maximumMicrounits:10}:{status:"completed",response:{decision:{type:"refusal"},mycellios:{creditsMicrounits:0}}});
 await mount();await enterPrompt("Is it urgent?");
 await act(async()=>{const field=node.querySelectorAll("textarea")[1]!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(field,"The service is down");field.dispatchEvent(new Event("input",{bubbles:true}));});
 await click("Ver precio");expect(JSON.parse(call.mock.calls.at(-1)![0].payload)).toMatchObject({state:"The service is down",prompt:"Is it urgent?"});
 await click("Crear y usar créditos");expect(node.textContent).toContain("El modelo no ha podido evaluar este texto");
});
