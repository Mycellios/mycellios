import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionRequest, JobPayload } from "../src/contracts/types.js";
import type { RuntimeLinkObservation } from "../src/contracts/runtime-link-observations.js";
import { createCoordinatorDeploymentCanaryEvidence, deploymentMetricsFromCanaryEvidence } from "../src/contracts/deployment-canary.js";
import { MeshService } from "../src/coordinator/mesh-service.js";
import type { WorkerHub } from "../src/coordinator/worker-hub.js";
import { Scheduler } from "../src/scheduler/scheduler.js";
import { MeshDatabase } from "../src/storage/database.js";
import { MeshStore } from "../src/storage/store.js";
import { addWorker } from "./helpers.js";

const input: ChatCompletionRequest = { model:"distributed-small",messages:[{role:"user",content:"unchanged prompt"}],
  max_tokens:32,deadline_ms:30_000,workload_class:"interactive",seed:42 };

function link(fromNodeId:string,toNodeId:string,rtt=10):RuntimeLinkObservation {
  const now=Date.now();return {fromNodeId,toNodeId,measuredAt:now,validUntil:now+60_000,
    rttP50Ms:rtt,rttP95Ms:rtt,jitterP95Ms:0,goodputMbpsP50:1000,
    successfulSamples:7,failedSamples:0,availability:1,confidence:1};
}
class Hub extends EventEmitter {
  connected=new Set<string>();sent:Array<{workerId:string;type:string;payload:unknown}>=[];
  connectedWorkerIds(){return new Set(this.connected);}
  isConnected(id:string){return this.connected.has(id);}
  send(workerId:string,type:string,payload:unknown){this.sent.push({workerId,type,payload});return this.isConnected(workerId);}
}

describe("capacity/dispatch regressions: real ledger, synthetic workers, zero model execution",()=>{
  let db:MeshDatabase,store:MeshStore,scheduler:Scheduler,observations:RuntimeLinkObservation[];
  beforeEach(()=>{db=new MeshDatabase(":memory:");store=new MeshStore(db);observations=[];
    scheduler=new Scheduler(store,{strictRuntimeLinks:true,runtimeLinkObservations:()=>observations});});
  afterEach(()=>{vi.restoreAllMocks();db.close();});
  const stage=(id:string,index:number,options:{speed?:number;trusted?:boolean}={})=>addWorker(store,{
    id,mode:"pipeline",stage:{index,total:2,layerStart:index*10,layerEnd:(index+1)*10},
    tokensPerSecond:options.speed??100,...(options.trusted===undefined?{}:{trusted:options.trusted}),
    distributedExecutor:{protocol:"gdlp-worker-tunnel/2",nodeId:id,stageHost:id+".relay",stagePort:43110,
      runtime:"python-safetensors",computeMode:"gpu-only",cpuEligible:false}});
  const options=()=>({allowPipeline:true,connectedWorkerIds:new Set(store.listWorkers().map(w=>w.id))});

  it("uses an alternate tail when the cheapest forward path has no measured return",()=>{
    const head=stage("head",0),bad=stage("bad-return",1),good=stage("good-return",1,{speed:50});
    observations.push(link("head","bad-return"),link("head","good-return"),link("good-return","head"));
    const route=scheduler.selectRoute(input,"alternate-return",options());
    expect(route?.stages.map(s=>s.workerId)).toEqual([head.id,good.id]);
    expect(route?.stages.some(s=>s.workerId===bad.id)).toBe(false);
  });
  it("ranks complete cycles including the return rather than only forward cost",()=>{
    stage("head",0);stage("slow-return",1);const good=stage("fast-cycle",1,{speed:95});
    observations.push(link("head","slow-return"),link("slow-return","head",450),
      link("head","fast-cycle"),link("fast-cycle","head"));
    expect(scheduler.selectRoute(input,"cycle-cost",options())?.stages[1]?.workerId).toBe(good.id);
  });
  it("keeps an alternate trusted path when the cheapest tail fails boundary policy",()=>{
    stage("head",0);stage("anonymous",1,{trusted:false});const trusted=stage("trusted",1,{speed:50});
    observations.push(link("head","anonymous"),link("anonymous","head"),link("head","trusted"),link("trusted","head"));
    expect(scheduler.selectRoute(input,"trusted-alternate",{...options(),routePolicy:{requireTrustedBoundaryIdentity:true}})
      ?.stages[1]?.workerId).toBe(trusted.id);
  });
  it("invalidates cached affinity when its measured return expires",()=>{
    stage("head",0);stage("tail",1);observations.push(link("head","tail"),link("tail","head"));
    const old=scheduler.selectRoute(input,"cached-links",options())!;store.saveSession("cached-links",input.model,old);
    observations[1]!.validUntil=Date.now()-1;
    expect(scheduler.selectRoute(input,"cached-links",options())).toBeNull();
  });
  it("does not revive a cached pipeline when pipeline dispatch is disabled",()=>{
    stage("head",0);stage("tail",1);observations.push(link("head","tail"),link("tail","head"));
    const old=scheduler.selectRoute(input,"disable-pipeline",options())!;store.saveSession("disable-pipeline",input.model,old);
    expect(scheduler.selectRoute(input,"disable-pipeline",{...options(),allowPipeline:false})).toBeNull();
  });
  it("recomputes cached scores before enforcing the cost policy",()=>{
    const w=addWorker(store,{id:"cached-fast",tokensPerSecond:500,ttftMs:1});
    const old=scheduler.selectRoute(input,"cached-cost",{})!;store.saveSession("cached-cost",input.model,old);
    const cap=structuredClone(w.capabilities);cap.deployments[0]!.tokensPerSecond=2;cap.deployments[0]!.ttftMs=8000;
    store.updateWorkerHeartbeat(w.id,cap,"online");
    const decision=scheduler.selectExecutionRouteDecision(input,"cached-cost",{routePolicy:{maxNormalizedCost:old.score+0.01}});
    expect(decision.selected).toBeNull();expect(decision.reasons).toContain("candidate_cost_exceeded");
  });
  it("evaluates canary freshness at the supplied scheduling snapshot",()=>{
    const w=addWorker(store,{id:"snapshot"});const now=Date.now()-8*24*60*60_000;
    const cap=structuredClone(w.capabilities),deployment=cap.deployments[0]!;
    const evidence=createCoordinatorDeploymentCanaryEvidence({challengeId:"challenge",nonce:"a".repeat(43),workerId:w.id,
      sessionId:"snapshot-canary",issuedAt:new Date(now-5000).toISOString(),expiresAt:new Date(now+1000).toISOString(),
      observedAt:new Date(now-1000).toISOString(),model:input.model,modelDigest:"sha256:"+"a".repeat(64),activationId:"activation",
      promptDigest:"sha256:"+"b".repeat(64),maxOutputTokens:32,warmupSamples:1,
      samples:[0,1,2].map(i=>({sampleId:"sample-"+i,outputTokens:32,activeMs:1000,ttftMs:200,completed:true}))});
    const metrics=deploymentMetricsFromCanaryEvidence(evidence,{model:input.model,modelDigest:evidence.modelDigest,
      activationId:"activation",workerId:w.id,now});
    Object.assign(deployment,{adapter:"mycellios-pipeline",verificationState:"verified",throughputSource:"measured",
      modelDigest:evidence.modelDigest,activationId:"activation",canaryEvidence:evidence,
      tokensPerSecond:metrics.tokensPerSecond,ttftMs:metrics.ttftMs});
    store.updateWorkerHeartbeat(w.id,cap,"online");db.raw.prepare("UPDATE workers SET last_seen_at=? WHERE id=?").run(now,w.id);
    expect(scheduler.selectRoute(input,"snapshot-route",{now})?.stages[0]?.workerId).toBe(w.id);
    expect(scheduler.selectRoute(input,"real-time-route",{})).toBeNull();
  });
  it.each(["context","memory","slots","pause","revision"])("revalidates %s before offering the primary lease",change=>{
    const primary=addWorker(store,{id:"primary",tokensPerSecond:100,modelDigest:"sha256:same"});
    const standby=addWorker(store,{id:"standby",tokensPerSecond:50,modelDigest:"sha256:same"});
    const hub=new Hub();hub.connected.add(primary.id);hub.connected.add(standby.id);
    const select=scheduler.selectRoutePlan.bind(scheduler);
    vi.spyOn(scheduler,"selectRoutePlan").mockImplementation((...args)=>{
      const plan=select(...args),cap=structuredClone(primary.capabilities),d=cap.deployments[0]!;
      if(change==="context")d.contextLimit=1;
      else if(change==="memory")cap.gpus[0]!.freeOfferedVramMb=0;
      else if(change==="slots")d.freeSlots=0;
      else if(change==="revision")d.modelDigest="sha256:different";
      store.updateWorkerHeartbeat(primary.id,cap,change==="pause"?"draining":"online");return plan;
    });
    const service=new MeshService(store,scheduler,hub as unknown as WorkerHub,30_000);
    const before=structuredClone(input),started=Date.now();const handle=service.submit(input,"dispatch-"+change);
    try {
      const offers=hub.sent.filter(x=>x.type==="lease.offer");expect(offers).toHaveLength(1);
      expect(offers[0]!.workerId).toBe(standby.id);
      const payload=offers[0]!.payload as JobPayload;expect(payload.request).toEqual({model:before.model,messages:before.messages,max_tokens:before.max_tokens,seed:before.seed});expect(input).toEqual(before);
      expect(payload.deadlineAt).toBeGreaterThanOrEqual(started+30_000);
      expect(payload.deadlineAt).toBeLessThanOrEqual(Date.now()+30_000);
      expect(store.getJob(handle.jobId)?.workerId).toBe(standby.id);
    } finally {service.cancel(handle.jobId);}
  });
  it("fails without any lease when all preplanned capacity disappears",()=>{
    const w=addWorker(store,{id:"gone-before-dispatch"}),hub=new Hub();hub.connected.add(w.id);
    const select=scheduler.selectRoutePlan.bind(scheduler);
    vi.spyOn(scheduler,"selectRoutePlan").mockImplementation((...args)=>{
      const plan=select(...args);store.setWorkerStatus(w.id,"draining");return plan;
    });
    const service=new MeshService(store,scheduler,hub as unknown as WorkerHub,30_000),handle=service.submit(input);
    try {expect(hub.sent.filter(x=>x.type==="lease.offer")).toHaveLength(0);
      expect(store.getJob(handle.jobId)?.status).toBe("failed");}
    finally {service.cancel(handle.jobId);}
  });
});
