// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { VideoEditor } from "./VideoEditor";
import type { VideoEditBridge, VideoEditProject } from "@rakazo/contracts";
let root: ReturnType<typeof createRoot> | undefined, node: HTMLDivElement;
afterEach(()=>{if(root)act(()=>root!.unmount());root=undefined;node?.remove();});
async function mount(bridge?: VideoEditBridge) {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);node=document.createElement("div");document.body.append(node);root=createRoot(node);
 await act(async()=>root!.render(<VideoEditor bridge={bridge} onBack={()=>{}}/>));
}
it("requires Desktop before uploading and never fabricates a credit balance",async()=>{
 await mount();expect(node.textContent).toContain("Mycellios Desktop");
 expect([...node.querySelectorAll("button")].find(b=>b.textContent?.includes("Subir vídeo"))?.disabled).toBe(true);
 expect(node.textContent).not.toMatch(/Saldo.*\d/);
});
it("restores a quote but blocks payment without an authoritative wallet",async()=>{
 const project: VideoEditProject={id:"61e7aeca-e2d4-4496-9559-5a4d87df5029",appId:"io.mycellios.video-edit",appVersion:"1.0.0",definitionHash:"hash",name:"clip.mp4",sourceHash:"hash",duration:5,width:1280,height:720,prompt:"Make it rain",status:"quoted",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),quote:{id:"c05ee58b-d5f4-49a0-b511-58930082716a",model:"wan",seller:"seller",protocol:"fal-video",resolution:"720p",creditsMicros:100000,expiresAt:new Date(Date.now()+60000).toISOString(),sourceHash:"hash",promptHash:"prompt"}};
 const request=vi.fn(async(input:any)=>input.action==="list"?{projects:[project],providerReady:true,creditsReady:false}:input.action==="artifact"?{data:"",mimeType:"video/mp4" as const}:project);
 await mount({request});await act(async()=>[...node.querySelectorAll("button")].find(b=>b.textContent?.includes("clip.mp4"))!.click());
 const pay=[...node.querySelectorAll("button")].find(b=>b.textContent?.includes("Editar por"));
 expect(pay?.disabled).toBe(true);expect(node.textContent).toContain("está desactivado");
 expect(request.mock.calls.some(([input])=>input.action==="submit")).toBe(false);
});
