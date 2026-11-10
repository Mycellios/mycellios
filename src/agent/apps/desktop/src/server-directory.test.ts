import { expect, it, vi } from "vitest";
import { ServerDirectory } from "./server-directory.js";
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
