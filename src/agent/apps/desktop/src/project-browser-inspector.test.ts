// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});
it("requires a trusted user click and omits editable values and hidden text",()=>{
  const handlers=new Map<string,any>(),ipc=new Map<string,any>();
  const send=vi.fn();
  const proxy=new Proxy(document,{get(target,key){
    if(key==="addEventListener")return (name:string,fn:any)=>handlers.set(name,fn);
    const value=Reflect.get(target,key,target);return typeof value==="function"?value.bind(target):value;
  }});
  const host=document.createElement("article");host.id="panel";
  host.innerHTML='<h1>Visible heading</h1><input value="PRIVATE"><textarea>PRIVATE TEXT</textarea><p hidden>HIDDEN</p>';
  document.body.append(host);
  vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([{}] as any);
  const code=readFileSync(path.join(import.meta.dirname,"project-browser-preload.cjs"),"utf8");
  new Function("require","document","Element","NodeFilter","getComputedStyle","CSS","addEventListener",code)(
    (name:string)=>{expect(name).toBe("electron");return {ipcRenderer:{on:(channel:string,fn:any)=>ipc.set(channel,fn),send}};},
    proxy,Element,NodeFilter,getComputedStyle,{escape:(value:string)=>value},()=>{},
  );
  expect(send).toHaveBeenCalledWith("desktop.preview.ready");
  ipc.get("desktop.preview.inspect")({}, {token:"native-generation",enabled:true});
  const event={target:host,isTrusted:false,preventDefault:vi.fn(),stopImmediatePropagation:vi.fn()};
  handlers.get("click")(event);expect(send).toHaveBeenCalledTimes(1);
  handlers.get("click")({...event,isTrusted:true});
  expect(send.mock.lastCall?.[0]).toBe("desktop.preview.selection");
  expect(send.mock.lastCall?.[1]).toMatchObject({token:"native-generation",selector:"article#panel",text:"Visible heading"});
  expect(JSON.stringify(send.mock.lastCall)).not.toContain("PRIVATE");
  expect(event.preventDefault).toHaveBeenCalledTimes(1);
});
