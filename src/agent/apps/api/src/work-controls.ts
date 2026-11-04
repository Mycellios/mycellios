import type { Actor } from "@rakazo/contracts";
import { controlWorkTree } from "@rakazo/db";
import { reconcileWorkStops } from "@rakazo/adapters";
import type { RouterDeps } from "./router.js";

/** Composer Stop also cancels children when the coordinator has already ended its turn. */
export async function stopWorkForThread(deps:Pick<RouterDeps,'prisma'|'sandbox'|'jobs'|'events'>,actor:Actor,threadId:string){
  const cutoff=new Date();
  for(let pass=0;pass<100;pass++){
    const tasks=await deps.prisma.task.findMany({where:{spaceId:actor.spaceId,userId:actor.userId,threadId,
      createdAt:{lte:cutoff},delegationState:{in:['queued','running','waiting']}},take:25});
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
