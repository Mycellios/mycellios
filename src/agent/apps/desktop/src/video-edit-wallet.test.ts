import {it,expect,vi,afterEach} from "vitest";
import {createHash} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {managedVideoEditClient} from "./video-edit-wallet.js";
import {VideoEditRuntime} from "./video-edit-runtime.js";
import type {VideoEditProject} from "../../../packages/contracts/src/video-edit.js";
const scope={owner:"alice",space:"personal",server:"http://127.0.0.1:5192"},dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const clip=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from("ftyp"),Buffer.alloc(40)]);
const hash=createHash("sha256").update(clip).digest("hex");
async function setup(){
 const root=await mkdtemp(path.join(tmpdir(),"mycellios-edit-wallet-test-"));dirs.push(root);let completed=false;
 const call=vi.fn(async(action:string,_payload:unknown):Promise<any>=>action==="info"?{enabled:true}:action==="quote"?
  {token:"server-signed",maximumMicrounits:104000,expiresAt:Date.now()+60000,offer:{model:"wan",seller:"peer",protocol:"fal-video",resolution:"720p"}}:
  action==="execute"?{status:"pending_reconciliation"}:action==="status"?{status:completed?"completed":"running",response:{artifactHash:hash,mycellios:{creditsMicrounits:104000}}}:{data:clip.toString("base64")});
 const client=managedVideoEditClient(scope,call),command=vi.fn(async()=>JSON.stringify({format:{duration:5},streams:[{codec_type:"video",codec_name:"h264",width:1280,height:720}]}));
 const provider={offers:vi.fn(async()=>[]),create:vi.fn(async()=>"unused"),retrieve:vi.fn(async()=>({status:"running" as const}))};
 const make=()=>new VideoEditRuntime(root,provider,undefined,command);const runtime=make();
 const request=(input:any)=>runtime.request(scope,input,async()=>true,client);
 const project=await request({action:"import",name:"clip.mp4",data:clip.toString("base64")}) as VideoEditProject;
 const quoted=await request({action:"quote",id:project.id,prompt:"Make it rain"}) as VideoEditProject;
 return {root,runtime,make,request,project,quoted,call,client,provider,complete:()=>{completed=true;}};
}
it("connects the existing editor to server quotes and recovers after restart without local wallet authority",async()=>{
 const f=await setup();const submit={action:"submit" as const,id:f.project.id,quoteId:f.quoted.quote!.id};
 expect(f.call.mock.calls.map(([action])=>action)).toEqual(["quote"]);expect(f.quoted.quote?.creditsMicros).toBe(104000);
 await Promise.all([f.request(submit),f.request(submit)]);
 expect(f.call.mock.calls.filter(([a])=>a==="execute")).toHaveLength(1);expect(f.provider.create).not.toHaveBeenCalled();
 const upload=f.call.mock.calls.find(([a])=>a==="execute")![1] as any;expect(upload.data).toBe(clip.toString("base64"));expect(upload.key).toMatch(/^edit:[a-f0-9]{64}$/);
 f.complete();const restored=await f.make().request(scope,{action:"get",id:f.project.id},async()=>true,f.client) as VideoEditProject;
 expect(restored).toMatchObject({status:"ready",resultHash:hash,chargedCreditsMicros:104000});
 expect(f.call.mock.calls.filter(([a])=>a==="execute")).toHaveLength(1);
});
it("keeps a lost response recoverable and never resends it automatically",async()=>{
 const f=await setup();f.call.mockImplementationOnce(async()=>{throw new Error("lost response");});
 const submit={action:"submit" as const,id:f.project.id,quoteId:f.quoted.quote!.id};
 expect(await f.request(submit)).toMatchObject({status:"uncertain"});
 await f.make().request(scope,submit,async()=>true,f.client);f.complete();
 expect(await f.request({action:"get",id:f.project.id})).toMatchObject({status:"ready"});
 expect(f.call.mock.calls.filter(([a])=>a==="execute")).toHaveLength(1);
});
it("refuses foreign projects and artifact/receipt mismatches",async()=>{
 const f=await setup();
 await expect(f.runtime.request({...scope,owner:"bob"},{action:"get",id:f.project.id},async()=>true,f.client)).rejects.toThrow();
 const bad=managedVideoEditClient(scope,async action=>action==="status"?{status:"completed",response:{artifactHash:"wrong",mycellios:{creditsMicrounits:104000}}}:{data:clip.toString("base64")});
 await expect(bad.get(f.quoted)).rejects.toThrow("no coincide");
});
it("does not invoke paid operations if the server disables the editor",async()=>{
 const f=await setup(),disabled=managedVideoEditClient(scope,async()=>{throw new Error("off");});
 expect(await f.runtime.request(scope,{action:"list"},async()=>true,disabled)).toMatchObject({creditsReady:false,providerReady:false});
 expect(f.provider.offers).not.toHaveBeenCalled();expect(f.provider.create).not.toHaveBeenCalled();
});
it("shows a confirmed insufficient balance as unsubmitted, not as an uncertain paid job",async()=>{
 const f=await setup();f.call.mockResolvedValueOnce({status:"not_submitted",code:"insufficient_contribution_credits"});
 const result=await f.request({action:"submit",id:f.project.id,quoteId:f.quoted.quote!.id});
 expect(result).toMatchObject({status:"draft",error:expect.stringContaining("No tienes suficientes créditos")});
 expect((result as VideoEditProject).quote).toBeUndefined();expect(f.provider.create).not.toHaveBeenCalled();
});
