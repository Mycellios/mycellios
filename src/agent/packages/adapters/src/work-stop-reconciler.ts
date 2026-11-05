import type { JobPublisher, SandboxProvider, ComputerRef } from "@rakazo/adapter-kit";
import { runJobKey } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { cancelComputerRunWorkArgv } from "./computer-idle.js";
import { projectLeaseOwner } from "./project-execution.js";

/** Durable teardown outbox; only explicit user tree controls put work in this queue. */
export async function reconcileWorkStops(deps: {
  prisma: PrismaClient; sandbox: SandboxProvider; jobs?: Pick<JobPublisher,"cancel">; events?: ThreadEvents;
}, scope?: {spaceId:string;userId:string}) {
  const tasks=await deps.prisma.task.findMany({where:{...scope,workStopPending:true},orderBy:{delegationCheckedAt:{sort:'asc',nulls:'first'}},take:25});
  const failures:string[]=[];
  for(const task of tasks){
    try {
    const payload=task.workStopTargets as unknown as {runIds:string[];targets:Array<{
      runId:string;botId:string;computerId:string;fence:number;kind:string;providerRef:string|null;homeKey:string;
    }>}|null;
    if(!payload||!Array.isArray(payload.targets)||!Array.isArray(payload.runIds))throw new Error('Invalid durable work teardown receipt');
    for(const target of payload.targets){
      const identity = projectLeaseOwner(target.botId);
      const run=await deps.prisma.run.findFirst({where:{id:target.runId,taskId:task.id,spaceId:task.spaceId,userId:task.userId,botId:identity?.botId ?? target.botId,...(identity ? {threadId:identity.projectSessionId}:{}),status:'cancelled'}});
      if(!run)throw new Error('Work teardown lost its exact cancelled-run identity');
      const computer:ComputerRef={id:target.computerId,botId:target.botId,kind:target.kind as ComputerRef['kind'],providerRef:target.providerRef??''};
      const context={operationId:`work-stop:${task.id}:${target.runId}`,traceId:`work-stop:${task.id}`,
        spaceId:task.spaceId,userId:task.userId,botId:target.botId,runId:target.runId,signal:AbortSignal.timeout(15000)};
      if(deps.sandbox.cancelRunWork)await deps.sandbox.cancelRunWork(computer,target.computerId,target.runId,context);
      else {
        if(computer.kind==='desktop')throw new Error('Native teardown is unavailable; its work remains paused');
        let exit:number|undefined;
        for await(const event of deps.sandbox.execute(computer,{argv:cancelComputerRunWorkArgv(target.computerId,target.runId),timeoutMs:15000},context))
          if(event.type==='exit')exit=event.code;
        if(exit!==0)throw new Error('Owned work teardown has no successful exit; it remains pending');
      }
      await deps.prisma.computerExecutionLease.deleteMany({where:{computerId:target.computerId,botId:target.botId,runId:target.runId,fence:target.fence}});
    }
    for(const runId of payload.runIds)await deps.jobs?.cancel(runJobKey(runId));
    await deps.prisma.task.updateMany({where:{id:task.id,spaceId:task.spaceId,userId:task.userId,delegationRevision:task.delegationRevision,workStopPending:true},data:{workStopPending:false}});
    if(deps.events){
      const events=await deps.prisma.event.findMany({where:{runId:{in:payload.runIds},spaceId:task.spaceId,type:'run.cancelled'},select:{threadId:true,seq:true}});
      for(const event of events)await deps.events.notify(event.threadId,event.seq);
    }
    } catch {
      failures.push(task.id);
      await deps.prisma.task.updateMany({where:{id:task.id,spaceId:task.spaceId,userId:task.userId,delegationRevision:task.delegationRevision,workStopPending:true},data:{delegationCheckedAt:new Date()}});
    }
  }
  if(failures.length)throw new Error(`Owned work teardown remains pending for ${failures.length} task(s); no replacement work was admitted`);
}
