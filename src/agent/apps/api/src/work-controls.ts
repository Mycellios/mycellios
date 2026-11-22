import type { Actor } from "@mycellios/contracts";
import { controlWorkTree, eventWaitState } from "@mycellios/db";
import { reconcileWorkStops } from "@mycellios/adapters";
import type { RouterDeps } from "./router.js";

/**
 * Composer Stop also cancels children when the coordinator has already ended its turn.
 * Archive passes keepEventWaits: a request parked only on await_event waits stays parked, and
 * the conversation comes back when a wait wakes. Stop cancels those waits too.
 */
export async function stopWorkForThread(deps:Pick<RouterDeps,'prisma'|'sandbox'|'jobs'|'events'>,actor:Actor,threadId:string,
  options:{keepEventWaits?:boolean}={}){
  const cutoff=new Date();
  for(let pass=0;pass<100;pass++){
    const found=await deps.prisma.task.findMany({where:{spaceId:actor.spaceId,userId:actor.userId,threadId,
      createdAt:{lte:cutoff},delegationState:{in:['queued','running','waiting']}},take:25,
      include:options.keepEventWaits?{workChildren:{select:{delegationState:true,workPlan:true}}}:undefined});
    const tasks=options.keepEventWaits?found.filter(task=>!parkedOnEventWaits(task)):found;
    if(!tasks.length){void reconcileWorkStops(deps,actor).catch(()=>undefined);return;}
    for(const task of tasks){
      try{await controlWorkTree(deps.prisma,actor,{taskId:task.id,expectedRevision:task.delegationRevision,action:'cancel'});}
      catch(error){
        const current=await deps.prisma.task.findFirst({where:{id:task.id,spaceId:actor.spaceId,userId:actor.userId}});
        if(current&&['queued','running','waiting'].includes(current.delegationState??''))
          await controlWorkTree(deps.prisma,actor,{taskId:current.id,expectedRevision:current.delegationRevision,action:'cancel'});
        else if(!current)throw error;
      }
    }
  }
  throw new Error('Work cancellation is still pending; inspect its durable state');
}

/** A request between turns whose unfinished children are all event waits. */
function parkedOnEventWaits(task:{delegationState:string|null;workChildren?:Array<{delegationState:string|null;workPlan:unknown}>}){
  if(task.delegationState!=='waiting')return false;
  const open=(task.workChildren??[]).filter(child=>!['completed','failed','cancelled'].includes(child.delegationState??''));
  return open.length>0&&open.every(child=>eventWaitState(child.workPlan));
}
