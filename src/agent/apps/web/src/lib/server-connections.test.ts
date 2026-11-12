// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { forgetBrowserServer, readBrowserServers, readServerView, safeServerUrl, saveBrowserServer, saveServerView, serverDisplayName } from "./server-connections";
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it.each(["javascript:alert(1)","http://public.example","https://user:secret@x.test","https://x.test/?token=secret","https://x.test/#secret","https://x.test/%2e%2e/","https://x.test\\evil","not an address"])("rejects unsafe connection %s", value => { expect(safeServerUrl(value)).toBeNull(); });
it.each(["http://127.0.0.1:5192","http://localhost:5192","http://[::1]:5192","https://example.test/agent"])("accepts explicit secure or loopback connection %s", value => { expect(safeServerUrl(value + "/")).toBe(value); });
it("preserves the current connection when storage is corrupt and deduplicates saved entries", () => {
 localStorage.setItem("mycellios.servers.v1", "invalid"); expect(readBrowserServers("http://localhost:5192")).toHaveLength(1);
 localStorage.setItem("mycellios.servers.v1", JSON.stringify([{serverUrl:"https://a.test",name:"A",token:"secret"},{serverUrl:"https://a.test"},{serverUrl:"javascript:bad"}]));
 const list=readBrowserServers("http://localhost:5192"); expect(list).toHaveLength(2); expect(list[1]).toEqual({mode:"existing",serverUrl:"https://a.test",name:"A"});
});
it("saves only bounded names and colors without credentials and updates an existing record", () => {
 saveBrowserServer({mode:"existing",serverUrl:"https://a.test/",name:" A ",color:"#aa3344"},"http://localhost:5192");
 saveBrowserServer({mode:"existing",serverUrl:"https://a.test",name:"Team",color:"#445566"},"http://localhost:5192");
 expect(readBrowserServers("http://localhost:5192").filter(e=>e.serverUrl==="https://a.test")).toEqual([{mode:"existing",serverUrl:"https://a.test",name:"Team",color:"#445566"}]);
 expect(()=>saveBrowserServer({mode:"existing",serverUrl:"https://a.test",name:" ",color:"url(evil)"},"http://localhost:5192")).toThrow();
});
it("removes only the selected inactive connection and protects the current one", () => {
 saveBrowserServer({mode:"existing",serverUrl:"https://a.test",name:"A"},"http://localhost:5192");
 expect(()=>forgetBrowserServer("http://localhost:5192/","http://localhost:5192")).toThrow();
 forgetBrowserServer("https://a.test","http://localhost:5192"); expect(readBrowserServers("http://localhost:5192")).toHaveLength(1);
});
it("propagates storage failures without claiming success", () => {
 vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("quota");});
 expect(()=>saveServerView("rail")).toThrow(); expect(readServerView()).toBe("menu");
});
it("persists the view and uses readable defaults without overwriting custom names", () => {
 expect(readServerView()).toBe("menu"); saveServerView("rail"); expect(readServerView()).toBe("rail");
 expect(serverDisplayName({mode:"existing",serverUrl:"http://127.0.0.1:5192",name:"127.0.0.1:5192"})).toBe("Mycellios local");
 expect(serverDisplayName({mode:"existing",serverUrl:"https://www.mycellios.com/agent",name:"www.mycellios.com"})).toBe("Mycellios");
 expect(serverDisplayName({mode:"existing",serverUrl:"https://a.test",name:"Team"})).toBe("Team");
});
