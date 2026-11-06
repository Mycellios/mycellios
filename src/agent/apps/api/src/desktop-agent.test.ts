import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import type { AdapterContext, AgentRunRequest } from "@rakazo/adapter-kit";
import { DesktopAgentRuntime } from "../../../packages/adapters/src/desktop-agent-runtime.js";
import { createDesktopAgentEngine } from "../../../packages/adapters/src/desktop-agent-engine.js";
import { desktopRelayKey, signDesktopRelay } from "../../../packages/adapters/src/desktop-relay.js";
import { startHostComputerServer } from "../../../packages/adapters/src/host-computer-server.js";
import { DesktopRelayClient } from "../../desktop/src/desktop-relay.js";
import { mountDesktopRelay } from "./desktop-relay.js";

it("runs an account Mico through the complete authenticated Desktop path with no renderer or model keys on the PC",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"mc-account-agent-"));
  const actor={userId:"owner",spaceId:"space",email:"fixture@example.invalid",isDeploymentOwner:false};
  const api=new Hono();let preferred=false;
  const close=mountDesktopRelay(api,{enabled:true,secret:"fixture-secret",authenticate:async()=>({actor,sessionId:"session"}),ownsBot:async(scope,id)=>scope.userId===actor.userId&&scope.spaceId===actor.spaceId&&id==="mico",desktopExecution:async(_scope,enabled)=>{if(enabled!==undefined)preferred=enabled;return preferred;}});
  let calls=0;
  const provider=createServer((request,response)=>{
    expect(request.headers.authorization).toBe("Bearer fixture-private-model-key");calls++;request.resume();
    response.writeHead(200,{"content-type":"text/event-stream"});
    for(const [delta,finish] of [[{role:"assistant",content:"OK"},null],[{},"stop"]])response.write(`data: ${JSON.stringify({id:"model-request",object:"chat.completion.chunk",created:1,model:"fixture",choices:[{index:0,delta,finish_reason:finish}],...(finish?{usage:{prompt_tokens:3,completion_tokens:1,total_tokens:4}}:{})})}\n\n`);
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve=>provider.listen(0,"127.0.0.1",resolve));
  const address=provider.address();if(!address||typeof address==="string")throw Error("fixture");
  const engine=createDesktopAgentEngine(root,()=>"a".repeat(64));
  const host=await startHostComputerServer({root,token:"d".repeat(64),hostname:"127.0.0.1",agentRuntime:engine});host.setEnabled(true);
  const native=new DesktopRelayClient({base:"http://fixture",fetch:async(url,init)=>{
    expect(init?.body).not.toContain("fixture-private-model-key");
    return api.request(new URL(url).pathname,init);
  },localUrl:`http://127.0.0.1:${host.port}`,localToken:"d".repeat(64),agentExecution:1,revoked:()=>host.setEnabled(false)});
  const internal=async(value:unknown,signal:AbortSignal)=>{
    const body=JSON.stringify(value),time=String(Date.now());
    expect(body).not.toContain("fixture-private-model-key");
    return api.request("/api/desktop-relay/internal",{method:"POST",headers:{"x-desktop-time":time,"x-desktop-signature":signDesktopRelay(desktopRelayKey("fixture-secret"),time,body)},body,signal});
  };
  const context:AdapterContext={userId:actor.userId,spaceId:actor.spaceId,botId:"mico",runId:"run",traceId:"trace",operationId:"operation",signal:new AbortController().signal};
  const fallback={describe:()=>engine.describe(),run:vi.fn(),abort:vi.fn()};
  const runtime=new DesktopAgentRuntime({fallback,select:async scope=>(await internal({probe:scope.botId,agentExecution:1,nonce:randomUUID(),scope:{userId:scope.userId,spaceId:scope.spaceId}},scope.signal)).json(),transport:(request,scope)=>internal({request,nonce:randomUUID(),scope:{userId:scope.userId,spaceId:scope.spaceId}},scope.signal)});
  try{
    await native.registerAccount(await native.identity());
    const request:AgentRunRequest={botId:"mico",threadId:"thread",runId:"run",prompt:"Reply OK",instructions:"Reply briefly",history:[],tools:[],allowSilentEmpty:true,model:{provider:"openai-compatible",id:"fixture",apiKey:"fixture-private-model-key",baseUrl:`http://127.0.0.1:${address.port}/v1`,allowPrivateEndpoint:true,maxTokens:128,contextWindow:8192}};
    let answer="";for await(const event of runtime.run(request,context))if(event.type==="text")answer+=event.text;
    expect(answer).toBe("OK");expect(calls).toBe(1);expect(preferred).toBe(true);expect(fallback.run).not.toHaveBeenCalled();
  }finally{native.stop();close();await host.close();provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
},15000);
