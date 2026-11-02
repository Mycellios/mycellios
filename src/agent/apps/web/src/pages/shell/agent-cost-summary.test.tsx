// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const {agent}=vi.hoisted(()=>({agent:vi.fn()}));
vi.mock("../../lib/rpc",()=>({rpc:{usage:{agent}}}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s.join(""),i18n:{locale:"en"}}),Trans:({children}:{children:React.ReactNode})=>children}));
import { AgentCostSummary } from "./agent-cost-summary";
afterEach(()=>{document.body.innerHTML="";vi.clearAllMocks();});
it.each([
 ["confirmed",0.25,"$0.25"], ["confirmed",0,"$0.00"], ["estimated",0.3,"Estimated AI cost"],
 ["pending",null,"AI cost pending"], ["unavailable",null,"AI cost unavailable"],
])("shows %s cost in the agent profile",async(state,amountUsd,label)=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);agent.mockResolvedValue({botId:"bot",state,amountUsd,modelCalls:2,unpricedCalls:0});
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<AgentCostSummary botId="bot"/>));expect(el.textContent).toContain("Total AI cost");expect(el.textContent).toContain(label);expect(agent).toHaveBeenCalledWith({botId:"bot"});if(state==="pending")expect(el.textContent).not.toContain("unavailable");}
 finally{await act(async()=>root.unmount());}
});
it("does not show a previous agent's delayed cost",async()=>{
 let finish!:(cost:unknown)=>void;agent.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValue({botId:"new",state:"confirmed",amountUsd:0.5});
 const el=document.createElement("div");document.body.append(el);const root=createRoot(el);
 try{await act(async()=>root.render(<AgentCostSummary botId="old"/>));await act(async()=>root.render(<AgentCostSummary botId="new"/>));await act(async()=>finish({botId:"old",state:"confirmed",amountUsd:9}));expect(el.textContent).toContain("$0.50");expect(el.textContent).not.toContain("$9.00");}
 finally{await act(async()=>root.unmount());}
});
