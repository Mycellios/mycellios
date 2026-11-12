import { expect, it, vi } from "vitest";
import { ServerDirectory } from "./server-directory.js";
import { registerServerDirectoryIpc } from "./server-directory-ipc.js";
async function fixture(current="https://a.test") {
 const handlers=new Map<string,(event:string,...args:unknown[])=>unknown>();
 const io={read:async()=>null,write:vi.fn(async()=>{})},directory=new ServerDirectory(io);
 await directory.remember({mode:"existing",serverUrl:"https://a.test"});io.write.mockClear();
 registerServerDirectoryIpc({handle:(name,handler)=>{handlers.set(name,handler);}},{directory,fromMain:(event:string)=>event==="owned-main",current:()=>current});
 return {io,directory,invoke:(name:string,event:string,...args:unknown[])=>handlers.get(name)!(event,...args)};
}
it("matches a loaded application route to the saved base connection",async()=>{
 const f=await fixture("https://a.test/app/chat");expect(f.invoke("desktop.servers.list","owned-main")).toMatchObject({current:"https://a.test"});
 const official=await fixture("https://www.mycellios.com/agent/app");expect(official.invoke("desktop.servers.list","owned-main")).toMatchObject({current:"https://www.mycellios.com/agent"});
});
it("denies both connection listing and identity mutation to non-main renderers",async()=>{
 const f=await fixture();expect(()=>f.invoke("desktop.servers.list","untrusted")).toThrow();
 await expect(f.invoke("desktop.servers.updateIdentity","untrusted","https://a.test",{name:"Bad",color:"#334455"})).rejects.toThrow();expect(f.io.write).not.toHaveBeenCalled();
});
it("updates only known connection metadata and leaves the current target unchanged",async()=>{
 const f=await fixture();await f.invoke("desktop.servers.updateIdentity","owned-main","https://a.test",{name:"Team",color:"#334455"});
 expect(f.invoke("desktop.servers.list","owned-main")).toEqual({current:"https://a.test",servers:[{mode:"existing",serverUrl:"https://a.test",name:"Team",color:"#334455"}]});
 await expect(f.invoke("desktop.servers.updateIdentity","owned-main","https://other.test",{name:"Other",color:"#334455"})).rejects.toThrow();
 expect(f.io.write).toHaveBeenCalledOnce();
});
it("rejects malformed addresses and never persists a remote mutation or credential",async()=>{
 const f=await fixture();await expect(f.invoke("desktop.servers.updateIdentity","owned-main",null,{name:"Team",color:"#334455"})).rejects.toThrow();
 await expect(f.invoke("desktop.servers.updateIdentity","owned-main","https://a.test",{name:"Team",color:"#334455",token:"secret"})).rejects.toThrow();expect(f.io.write).not.toHaveBeenCalled();
});
