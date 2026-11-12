// @vitest-environment jsdom
import type {ReactNode} from "react";
import {act} from "react";
import{createRoot}from"react-dom/client";
import{beforeEach,expect,it,vi}from"vitest";
const{agents}=vi.hoisted(()=>({agents:vi.fn()}));
vi.mock("../lib/rpc",()=>({rpc:{usage:{agents}}}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join(""),i18n:{locale:"en"}}),Trans:({children}:{children:ReactNode})=>children}));
import{AgentUsageSettings}from"./AgentUsageSettings";
import{getResponseCostVisible,setResponseCostVisible}from"../lib/response-cost-preference";
import {SpaceRpcProvider} from "../lib/space-rpc";
import type {RpcClient} from "../lib/rpc";
const totals={state:"confirmed",amountUsd:0.000298,knownAmountUsd:0.000298,inputTokens:1200,outputTokens:30,totalTokens:1230,knownInputTokens:1200,knownOutputTokens:30,knownTotalTokens:1230,modelCalls:2,unpricedCalls:0,estimatedCalls:0};
const report={total:totals,agents:[{...totals,botId:"a",name:"Mico",archived:false},{...totals,botId:"b",name:"Archived agent",archived:true,amountUsd:null,knownAmountUsd:0.1,state:"pending",unpricedCalls:1,estimatedCalls:1,totalTokens:null,knownTotalTokens:200}]};
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);setResponseCostVisible(false);agents.mockReset().mockResolvedValue(report);});
it("shows per-agent tokens, precise micro-costs and partial estimates",async()=>{
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<AgentUsageSettings/>));expect(el.querySelectorAll('[data-testid="agent-usage-row"]')).toHaveLength(2);expect(el.textContent).toContain("Mico");expect(el.textContent).toContain("1,230");expect(el.textContent).toContain("$0.000298");expect(el.textContent).toContain("Partial");expect(el.textContent).toContain("Estimated AI cost");expect(el.textContent).toContain("Archived");}
 finally{await act(async()=>root.unmount());el.remove();}
});
it("changes the global response-cost switch without model calls",async()=>{
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<AgentUsageSettings/>));const toggle=el.querySelector<HTMLButtonElement>('[data-testid="response-cost-toggle"]')!;
 expect(toggle.getAttribute("aria-checked")).toBe("false");await act(async()=>toggle.click());expect(getResponseCostVisible()).toBe(true);expect(localStorage.getItem("mycellios.showResponseCost")).toBe("on");await act(async()=>toggle.click());expect(getResponseCostVisible()).toBe(false);expect(agents).toHaveBeenCalledTimes(1);}
 finally{await act(async()=>root.unmount());el.remove();}
});
it("allows retrying an unavailable usage report",async()=>{
 agents.mockRejectedValueOnce(new Error("offline"));const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<AgentUsageSettings/>));expect(el.querySelector('[role="alert"]')).not.toBeNull();await act(async()=>[...el.querySelectorAll('button')].find(x=>x.textContent==="Retry")!.click());expect(el.querySelector('[role="alert"]')).toBeNull();expect(el.textContent).toContain("Mico");}
 finally{await act(async()=>root.unmount());el.remove();}
});

it("uses the bound Space client and hides prior totals while the new Space is loading",async()=>{
 const scoped=vi.fn(async()=>report);
 let resolveNext!:(value:typeof report)=>void;
 const pending=new Promise<typeof report>(resolve=>{resolveNext=resolve;});
 const first={usage:{agents:scoped}} as unknown as RpcClient;
 const next={usage:{agents:()=>pending}} as unknown as RpcClient;
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try {
  await act(async()=>root.render(<SpaceRpcProvider spaceId="first" client={first}><AgentUsageSettings/></SpaceRpcProvider>));
  expect(scoped).toHaveBeenCalledTimes(1);expect(agents).not.toHaveBeenCalled();
  expect(el.querySelector('[data-testid="usage-total"]')).not.toBeNull();
  await act(async()=>root.render(<SpaceRpcProvider spaceId="next" client={next}><AgentUsageSettings/></SpaceRpcProvider>));
  expect(el.querySelector('[data-testid="usage-total"]')).toBeNull();
  await act(async()=>resolveNext({...report,agents:[]}));
  expect(el.textContent).toContain("No agent usage yet");
 } finally {await act(async()=>root.unmount());el.remove();}
});
