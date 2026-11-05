import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { PrismaClient, Prisma } from "./client.js";
import { cancelRunsInTransaction } from "./cancel-runs.js";
import { appendEventInTransaction } from "./events.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";

export async function controlWorkTree(prisma: PrismaClient, actorInput: {spaceId:string;userId:string}, input: {
  taskId:string; expectedRevision:number; action:"pause"|"resume"|"cancel"|"reassign"; botId?:string;
}) {
  const actor = { spaceId: actorInput.spaceId, userId: actorInput.userId };
  return withTransactionRetry(()=>prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${`work:${actor.spaceId}:${actor.userId}`}, 0))`;
    const selected=await tx.task.findFirst({where:{id:input.taskId,...actor}});
    if(!selected?.delegationState)throw new IsolationError();
    if(selected.delegationState==='completed')throw new Error('This work has already finished');
    if(selected.delegationRevision!==input.expectedRevision)throw new Error("Work changed; reload its current revision");
    const root=selected.delegationRootId??selected.id;
    const all=await tx.task.findMany({where:{...actor,OR:[{id:root},{delegationRootId:root}]},take:25});
    const ids=new Set([selected.id]);
    for(let n=0;n<all.length;n++)for(const task of all)if(task.parentTaskId&&ids.has(task.parentTaskId))ids.add(task.id);
    const tasks=all.filter(task=>ids.has(task.id));
    if(input.action==='pause'||input.action==='cancel'){
      let revision = selected.delegationRevision;
      for(const task of tasks){
        if(['completed','cancelled'].includes(task.delegationState??''))continue;
        if(task.workStopPending)continue;
        const runs=await tx.run.findMany({where:{taskId:task.id,...actor,status:{in:[...ACTIVE_RUN_STATUSES]}}});
        const leases=await tx.computerExecutionLease.findMany({where:{runId:{in:runs.map(run=>run.id)}},include:{computer:true}});
        const targets=leases.map(lease=>({runId:lease.runId,botId:lease.botId,computerId:lease.computerId,fence:lease.fence,
          kind:lease.computer.kind,providerRef:lease.computer.providerRef,homeKey:lease.computer.homeKey}));
        const legacy=await tx.computer.findMany({where:{...actor,executionRunId:{in:runs.map(run=>run.id)}}});
        for(const computer of legacy)if(computer.executionRunId&&computer.executionBotId&&
          !targets.some(target=>target.runId===computer.executionRunId&&target.computerId===computer.id))
          targets.push({runId:computer.executionRunId,botId:computer.executionBotId,computerId:computer.id,fence:-1,
            kind:computer.kind,providerRef:computer.providerRef,homeKey:computer.homeKey});
        await cancelRunsInTransaction(tx,runs,new Date());
        for(const run of runs)await appendEventInTransaction(tx,{spaceId:actor.spaceId,threadId:run.threadId,
          botId:run.botId,runId:run.id,type:'run.cancelled',allowCancelledRun:true,payload:{reason:'work_tree_control'}});
        await tx.task.update({where:{id:task.id},data:{paused:true,delegationState:input.action==='cancel'?'cancelled':'paused',
          assignmentVersion:{increment:1},delegationRevision:{increment:1},workStopPending:true,
          workStopTargets:{runIds:runs.map(run=>run.id),targets} as Prisma.InputJsonValue}});
        if(task.id===selected.id)revision++;
      }
      return {taskId:selected.id,revision,paused:true};
    }
    if(!selected.paused||selected.delegationState==='cancelled')throw new Error('Pause active work before changing its owner; cancelled work is not resumed');
    if(tasks.some(task=>task.workStopPending)||await tx.run.count({where:{taskId:{in:[...ids]},OR:[
      {status:{in:[...ACTIVE_RUN_STATUSES]}},{leaseOwner:{not:null},leaseExpiresAt:{gt:new Date()}}
    ]}}))throw new Error('The previous owned processes are still stopping; inspect again shortly');
    let destination: {botId:string;threadId:string}|undefined;
    if(input.action==='reassign'){
      const bot=await tx.bot.findFirst({where:{id:input.botId,...actor,archivedAt:null},include:{thread:true}});
      if(!bot?.thread)throw new IsolationError();
      const thread=await tx.thread.findFirst({where:{id:selected.threadId,...actor},include:{group:{include:{members:true}}}});
      if(thread?.group&&!thread.group.members.some(member=>member.botId===bot.id))throw new IsolationError();
      if(!thread)throw new IsolationError();
      const destinationThread=thread.group?thread:await tx.thread.create({data:{...actor,
        taskBotId:bot.id,projectKey:thread.projectKey??`work:${root}`,
        taskKey:`work-transfer:${selected.id}:${selected.delegationRevision}`,title:thread.title??selected.prompt.slice(0,100)}});
      destination={botId:bot.id,threadId:destinationThread.id};
    }
    for(const task of tasks){
      if(task.delegationState!=='paused')continue;
      const pending=tasks.some(child=>child.parentTaskId===task.id&&!['completed','cancelled'].includes(child.delegationState??''));
      await tx.task.update({where:{id:task.id},data:{paused:false,delegationState:pending?'waiting':'queued',
        status:'queued',delegatedRunId:null,returnRunId:null,assignmentVersion:{increment:1},delegationRevision:{increment:1},
        ...(task.id===selected.id?destination:{}),
        prompt:`${task.prompt}\n\nRecovery of interrupted work: inspect command_status and existing effects before any new write. Do not repeat completed or uncertain actions. This resume does not expand permissions.`}});
      // A root without children has no parent dispatcher; start one fenced queued run here.
      if(!pending&&!task.parentTaskId){
        const run=await tx.run.create({data:{...actor,taskId:task.id,botId:destination?.botId??task.botId,
          threadId:destination?.threadId??task.threadId,status:'queued',trigger:'task_return',
          clientNonce:`work-resume:${task.id}:${task.delegationRevision}`}});
        await tx.task.update({where:{id:task.id},data:{delegationState:'running',returnRunId:run.id}});
      }
    }
    return {taskId:selected.id,revision:selected.delegationRevision+1,paused:false};
  },{maxWait:5000,timeout:20000}));
}
