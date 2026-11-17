import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { DesktopRelayClient } from "./desktop-relay.js";
import { startDesktopDiagnostics } from "./diagnostics.js";

it.each([
  { kind:"network",code:"native_transport_interrupted",stage:"native_request" },
  { kind:"status",code:"native_host_failure",stage:"native_request" },
  { kind:"truncated",code:"stream_incomplete",stage:"native_stream" },
])("keeps $kind failure correlated from native execution to the local support copy",async({kind,code,stage})=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"mycellios-relay-diagnostic-"));
  const journal=startDesktopDiagnostics(root,"1.2.3","win32");
  const native=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{
    if(kind === "network")throw new TypeError("private-url token=private-secret",{cause:Object.assign(new Error(),{code:"ECONNRESET"})});
    return kind === "status" ? new Response("private body",{status:503}) : new Response('{"unfinished":');
  });
  const id="12345678-1234-4321-8765-123456789abc",runId="cm00000000000000000000003";
  const identity={userId:"owner",spaceId:"space",connectionId:"session"};
  let binding:unknown,delivered=false;const reports:Record<string,unknown>[]=[];
  const client=new DesktopRelayClient({base:"https://example.test",localUrl:"http://127.0.0.1:1234",localToken:"private-secret",revoked:vi.fn(),fetch:async(url,init)=>{
    const action=url.split("/").at(-1),value=JSON.parse(String(init?.body));
    if(action === "identity")return Response.json(identity);
    if(action === "bind"){binding=value;return Response.json({ok:true});}
    if(action === "result"){reports.push(JSON.parse(Buffer.from(value.data,"base64").toString()));return Response.json({ok:true});}
    const operations=delivered?[]:[{id,binding,request:{method:"agentRun",botId:"bot",runId,sessionId:id,request:{}}}];delivered=true;
    return Response.json({identity,active:[id],operations});
  }});
  try {
    await client.bind("bot");await vi.waitFor(()=>expect(reports).toHaveLength(1));
    expect(reports[0]).toMatchObject({code,stage,operationId:id});
    expect(native).toHaveBeenCalledTimes(1);
    const text=await journal.copyText();expect(text).not.toMatch(/private-secret|private-url|private body/);
    expect(JSON.parse(text).events).toEqual(expect.arrayContaining([expect.objectContaining({event:"operation_failed",runId,operationId:id,code,stage})]));
  } finally {client.stop();await journal.close();native.mockRestore();await rm(root,{recursive:true,force:true});}
});
