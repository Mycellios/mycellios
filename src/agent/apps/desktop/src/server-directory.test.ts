import { expect, it, vi } from "vitest";
import { ServerDirectory } from "./server-directory.js";
it("persists connection identity independently and preserves it through reconnect and reload", async () => {
 let raw:string|null=null; const io={read:async()=>raw,write:vi.fn(async(value:string)=>{raw=value;})}; const directory=new ServerDirectory(io);
 await directory.remember({mode:"existing",serverUrl:"https://a.test"}); await directory.remember({mode:"existing",serverUrl:"https://b.test"});
 await directory.updateIdentity("https://a.test",{name:" My team ",color:"#336677"});
 await directory.remember({mode:"existing",serverUrl:"https://a.test"}); const restored=new ServerDirectory(io); await restored.load();
 expect(restored.list().find(e=>e.serverUrl==="https://a.test")).toEqual({mode:"existing",serverUrl:"https://a.test",name:"My team",color:"#336677"});
 expect(restored.list().find(e=>e.serverUrl==="https://b.test")?.name).toBe("b.test");
});
it.each([{name:"",color:"#334455"},{name:"a".repeat(81),color:"#334455"},{name:"Team",color:"url(evil)"},{name:"Team",color:"#334455",serverUrl:"https://other.test"}])("rejects invalid connection identity before writing", async identity => {
 const io={read:async()=>null,write:vi.fn(async()=>{})},directory=new ServerDirectory(io);
 await directory.remember({mode:"existing",serverUrl:"https://a.test"});io.write.mockClear();
 expect(()=>directory.updateIdentity("https://a.test",identity)).toThrow();expect(io.write).not.toHaveBeenCalled();
});
it("does not create unknown servers or mutate memory after an identity write failure",async()=>{
 const io={read:async()=>null,write:vi.fn(async()=>{})},directory=new ServerDirectory(io);
 await directory.remember({mode:"existing",serverUrl:"https://a.test"});
 await expect(directory.updateIdentity("https://b.test",{name:"B",color:"#334455"})).rejects.toThrow("Unknown server");
 io.write.mockRejectedValueOnce(Error("disk"));await expect(directory.updateIdentity("https://a.test",{name:"Changed",color:"#334455"})).rejects.toThrow();
 expect(directory.list()[0]?.name).toBe("a.test");
});
it("validates saved addresses and deduplicates without loading credentials", async () => {
 const io={read:async()=>JSON.stringify({schema:1,servers:[{mode:"existing",serverUrl:"http://public.example"},{mode:"existing",serverUrl:"https://user:secret@x.test"},{mode:"existing",serverUrl:"https://a.test",name:"A"},{mode:"existing",serverUrl:"https://a.test"}]}),write:vi.fn(async()=>{})};
 const dir=new ServerDirectory(io); await dir.load(); expect(dir.list()).toEqual([{mode:"existing",serverUrl:"https://a.test",name:"A"}]);
});
it("serializes writes, preserves other servers and leaves memory unchanged after a failed save", async () => {
 const io={read:async()=>null,write:vi.fn(async(_raw:string)=>{})}; const dir=new ServerDirectory(io);
 await Promise.all([dir.remember({mode:"existing",serverUrl:"https://a.test"}),dir.remember({mode:"existing",serverUrl:"https://b.test"})]); expect(dir.list()).toHaveLength(2);
 io.write.mockRejectedValueOnce(Error("disk")); await expect(dir.remove("https://a.test")).rejects.toThrow(); expect(dir.list()).toHaveLength(2);
 await dir.remove("https://a.test"); expect(dir.list()[0].serverUrl).toBe("https://b.test");
});
