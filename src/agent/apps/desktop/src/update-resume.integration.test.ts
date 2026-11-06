import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import type { AdapterContext } from "@rakazo/adapter-kit";
import { DesktopRelayBroker } from "../../../packages/adapters/src/desktop-relay.js";
import { HostComputerSandbox } from "../../../packages/adapters/src/host-computer-sandbox.js";
import { startHostComputerServer } from "../../../packages/adapters/src/host-computer-server.js";
import { ComputerUpdatingError } from "../../../packages/adapters/src/computer-errors.js";
import { DesktopRelayClient } from "./desktop-relay.js";
import { restoreUpdateBinding, saveUpdateResume } from "./update-resume.js";

it("interrupts an owned real command, reconnects the same run, and never starts the command twice", async () => {
  const profile=await realpath(await mkdtemp(path.join(os.tmpdir(),"desktop-update-loopback-")));
  const token="a1".repeat(32), base="https://fixture.test/agent";
  const owner={userId:"owner",spaceId:"space",sessionId:"session"};
  const identity={userId:owner.userId,spaceId:owner.spaceId,connectionId:owner.sessionId};
  const broker=new DesktopRelayBroker();
  let host=await startHostComputerServer({root:path.join(profile,"computers"),token,hostname:"127.0.0.1"});
  host.setEnabled(true);
  const ctx=(runId:string):AdapterContext=>({operationId:runId,traceId:runId,...owner,runId,signal:new AbortController().signal});
  const transport:typeof fetch=async(url,init)=>{
    const action=String(url).split("/").at(-1), data=JSON.parse(String(init?.body ?? "{}"));
    if(action==="identity") return Response.json(identity);
    if(action==="account") {
      broker.register(owner,data);broker.connectAccountBot(owner,"mico");
      return Response.json({...broker.poll(owner,data.deviceId),identity});
    }
    if(action==="result") {broker.result(owner,data.deviceId,data.id,data.seq,data.data,data.done);return Response.json({ok:true});}
    throw Error("Unexpected fixture request");
  };
  const makeClient=()=>new DesktopRelayClient({base,fetch:transport,localUrl:`http://127.0.0.1:${host.port}`,localToken:token,revoked:()=>{},
    restoreUpdate:(id)=>restoreUpdateBinding(profile,"0.3.17",base,id)});
  let native=makeClient();
  try {
    const direct=new HostComputerSandbox(`http://127.0.0.1:${host.port}`,token);
    const computer=await direct.provision({botId:"mico",homePath:"unused"},ctx("setup"));
    await native.registerAccount(identity);
    const worker=new HostComputerSandbox("","",async(request,context)=>broker.request(request,context));
    const marker=path.join(host.workspace("mico"),"once.txt");
    const command={commandId:"update-once",argv:[process.execPath,"-e","require('node:fs').appendFileSync(process.argv[1],'x');console.log('ready');setInterval(()=>{},1000)",marker],timeoutMs:30000};
    let notified=false;
    const context={...ctx("same-run"),botId:"mico",onComputerUpdate:()=>{notified=true;}};
    const events=worker.execute(computer,command,context)[Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({type:"stdout"});
    const interrupted=events.next().catch(error=>error);
    await saveUpdateResume(profile,"0.3.16","0.3.17",native.resumeBindings());
    await native.beginUpdate();
    await host.prepareUpdate();
    expect(await interrupted).toBeInstanceOf(ComputerUpdatingError);
    expect(notified).toBe(true);
    native.stop();await host.close();
    host=await startHostComputerServer({root:path.join(profile,"computers"),token,hostname:"127.0.0.1"});host.setEnabled(true);
    native=makeClient();await native.registerAccount(identity);
    const recovered:unknown[]=[];
    for await (const event of worker.execute(computer,command,context)) recovered.push(event);
    expect(recovered).toContainEqual({type:"exit",code:130});
    expect(await readFile(marker,"utf8")).toBe("x");
  } finally { native.stop();broker.close();await host.close();await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
},30000);
