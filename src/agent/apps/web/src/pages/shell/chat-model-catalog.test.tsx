// @vitest-environment jsdom
import {act} from "react";
import {mkdirSync,writeFileSync} from "node:fs";
import {createRoot} from "react-dom/client";
import {afterEach,it,expect,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
const {catalog}=vi.hoisted(()=>({catalog:vi.fn()}));
vi.mock("../../lib/space-rpc",()=>({useSpaceRpc:()=>({models:{mycelliosModels:catalog}})}));
vi.mock("@lingui/react/macro",()=>({useLingui:()=>({t:(s:TemplateStringsArray)=>s[0]})}));
import {ChatModelCatalog} from "./chat-model-catalog";
let root:ReturnType<typeof createRoot>,node:HTMLDivElement,client:QueryClient;
afterEach(()=>{if(root)act(()=>root.unmount());node?.remove();client?.clear();catalog.mockReset();});
it("shows native and external model names together under Mycellios, with prices before selection",async()=>{
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);catalog.mockResolvedValue([
  {id:"native-text",label:"Network model",billing:"Uses your Mycellios credits"},
  {id:"mycellios/managed/vendor/text",label:"GPT example",billing:"Credits / 1M tokens · Input 1.04 · Output 2.08 · 4% included"},
 ]);
 node=document.createElement("div");document.body.append(node);root=createRoot(node);client=new QueryClient({defaultOptions:{queries:{retry:false}}});const pick=vi.fn();
 await act(async()=>root.render(<QueryClientProvider client={client}><ChatModelCatalog userId="alice" spaceId="personal" source={{label:"Mycellios",provider:"openai-compatible",models:[],connection:{id:"owned",label:"Mycellios",provider:"openai-compatible",hasKey:true,isDefault:false,baseUrl:"https://www.mycellios.com/v1"}}} onBack={()=>{}} onPick={pick}/></QueryClientProvider>));
 await act(async()=>{await vi.waitFor(()=>expect(node.textContent).toContain("GPT example"));});
 expect(node.textContent).toContain("Network model");expect(node.textContent).not.toContain("OpenRouter");expect(pick).not.toHaveBeenCalled();
 await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="GPT example")!.click());
 expect(node.textContent).toContain("4% included");expect(pick).not.toHaveBeenCalled();
 mkdirSync("outputs/automatic-mycellios-model-catalog",{recursive:true});
 writeFileSync("outputs/automatic-mycellios-model-catalog/visual.html",`<!doctype html><html lang="en" data-theme="light"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/preview.css"><body class="bg-background text-foreground"><main style="max-width:380px;margin:32px auto;padding:16px"><p class="mb-4 text-xs text-muted-foreground">Local preview · example models · no spend</p>${node.innerHTML}</main></body></html>`);
 await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent==="Enable and use")!.click());
 expect(pick).toHaveBeenCalledWith("mycellios/managed/vendor/text",true);
});
