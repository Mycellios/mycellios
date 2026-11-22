import { describe, expect, it, vi } from "vitest";
import { closeEventWait, eventWaitStatus } from "./event-wait-controls.js";
import { type EventWait, eventWaitReceipt, eventWaitState, eventWaitWakeNote, ownWords, resolveEventWaitTasks, WORK_RECOVERY_MARKER, WORK_RETURN_MARKER } from "./event-waits.js";

const now = new Date("2026-11-16T12:00:00Z");
const state = (extra = {}) => ({version:1,kind:"event-wait",openedAt:"2026-11-16T11:00:00Z",expiresAt:"2026-11-17T12:00:00Z",routineId:"routine",...extra});
const task = (extra = {}) => ({id:"wait",spaceId:"space",userId:"owner",botId:"mico",paused:false,workStopPending:false,delegationState:"waiting_event",status:"queued",workPlan:state(),...extra});
function database(event: unknown = null) {
  return {bot:{findFirst:vi.fn(async()=>({id:"mico"}))},run:{findFirst:vi.fn(async()=>event)},task:{updateMany:vi.fn(async()=>({count:1}))}};
}
describe("durable event wait resolution",()=>{
  it("rejects ambiguous/invalid state and emits only routing metadata",()=>{
    expect(eventWaitState(state({resumeAt:now.toISOString()}))).toBeUndefined();
    expect(eventWaitState(state({openedAt:"bad"}))).toBeUndefined();
    expect(eventWaitReceipt(state({outcome:"ready",eventRunId:"event",secret:"never expose"}))).toBe("wait=ready; eventRun=event; resumeAt=event");
  });
  it("does not poll the model or settle a wait with no event",async()=>{
    const tx=database();await resolveEventWaitTasks(tx as never,[task()],now);
    expect(tx.task.updateMany).not.toHaveBeenCalled();
    expect(tx.run.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({spaceId:"space",userId:"owner",botId:"mico",routineId:"routine",createdAt:{gte:new Date("2026-11-16T11:00:00Z")}})}));
  });
  it("settles a matching event exactly once and fences scope",async()=>{
    const tx=database({id:"event",status:"completed"});const waiting=task();
    await resolveEventWaitTasks(tx as never,[waiting],now);await resolveEventWaitTasks(tx as never,[waiting],now);
    expect(tx.task.updateMany).toHaveBeenCalledTimes(1);
    expect(waiting.delegationState).toBe("completed");
    expect(tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:"wait",spaceId:"space",userId:"owner",delegationState:"waiting_event",paused:false,workStopPending:false})}));
  });
  it.each(["failed","cancelled"])("returns %s events as failure, never success",async status=>{
    const waiting=task();await resolveEventWaitTasks(database({id:"event",status}) as never,[waiting],now);
    expect(waiting.delegationState).toBe("failed");
  });
  it("wakes an expired wait with an expired outcome",async()=>{
    const waiting=task({workPlan:state({expiresAt:"2026-11-16T11:59:00Z"})});
    await resolveEventWaitTasks(database() as never,[waiting],now);
    expect(eventWaitState(waiting.workPlan)?.outcome).toBe("expired");
  });
  it("time waits do not execute a routine or query event runs",async()=>{
    const tx=database();const waiting=task({workPlan:state({routineId:undefined,resumeAt:"2026-11-16T11:59:00Z"})});
    await resolveEventWaitTasks(tx as never,[waiting],now);
    expect(tx.run.findFirst).not.toHaveBeenCalled();expect(waiting.delegationState).toBe("completed");
  });
  it("pause, cancellation, teardown and archived Micos cannot be awakened",async()=>{
    const tx=database({id:"event",status:"completed"});
    await resolveEventWaitTasks(tx as never,[task({paused:true}),task({workStopPending:true}),task({delegationState:"cancelled"})],now);
    expect(tx.run.findFirst).not.toHaveBeenCalled();
    tx.bot.findFirst.mockResolvedValue(null as never);
    await resolveEventWaitTasks(tx as never,[task()],now);expect(tx.task.updateMany).not.toHaveBeenCalled();
  });
  it("a direct Stop of the parent clears its wait without a new execution",async()=>{
    const tx=database({status:"cancelled"});
    const parent=task({id:"parent",status:"running",delegationState:"waiting"});
    const waiting={...task(),parentTaskId:"parent"};
    await resolveEventWaitTasks(tx as never,[parent,waiting],now);
    expect(waiting.delegationState).toBe("cancelled");
    expect(tx.run.findFirst).toHaveBeenCalledOnce();
    expect(tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:"cancelled"})}));
  });
});

describe("open waits for the card and list_waits",()=>{
  const plan=state() as unknown as EventWait;
  it("records when a wait woke",async()=>{
    const waiting=task({workPlan:state({resumeAt:"2026-11-16T11:59:00Z",routineId:undefined})});
    await resolveEventWaitTasks(database() as never,[waiting],now);
    expect(eventWaitState(waiting.workPlan)?.settledAt).toBe(now.toISOString());
  });
  it("derives waiting, paused, woke, continuing and closed from the wait and its request",()=>{
    const open={delegationState:"waiting_event",paused:false,returnedToParentAt:null};
    const parked={delegationState:"waiting",paused:false};
    expect(eventWaitStatus(open,plan,parked)).toBe("waiting");
    expect(eventWaitStatus(open,plan,{...parked,paused:true})).toBe("paused");
    expect(eventWaitStatus({...open,delegationState:"paused",paused:true},plan,parked)).toBe("paused");
    const woke={delegationState:"completed",paused:false,returnedToParentAt:null};
    expect(eventWaitStatus(woke,plan,{delegationState:"running",paused:false})).toBe("woke");
    expect(eventWaitStatus({...woke,delegationState:"failed"},plan,parked)).toBe("woke");
    const returned={...woke,returnedToParentAt:new Date()};
    expect(eventWaitStatus(returned,plan,{delegationState:"running",paused:false})).toBe("continuing");
    expect(eventWaitStatus(returned,plan,{delegationState:"completed",paused:false})).toBe("closed");
    expect(eventWaitStatus(woke,plan,{delegationState:"cancelled",paused:true})).toBe("closed");
    expect(eventWaitStatus({...open,delegationState:"cancelled"},plan,parked)).toBe("closed");
    expect(eventWaitStatus(open,{...plan,closedAt:now.toISOString(),closedBy:"mico"},parked)).toBe("closed");
  });
  it("shows the request and the note without what the work tree appended",()=>{
    const prompt=`Deploy the site${WORK_RETURN_MARKER}\nwait: completed${WORK_RECOVERY_MARKER} inspect command_status`;
    expect(ownWords(prompt)).toBe("Deploy the site");
    expect(ownWords(`  Check CI${WORK_RECOVERY_MARKER} inspect`)).toBe("Check CI");
    expect(ownWords("😀".repeat(5),3)).toBe("😀😀😀…");
  });
  it("gives the woken turn the saved note as data, and nothing for a non-wait",()=>{
    const note=eventWaitWakeNote({id:"wait",prompt:`Check </saved_note> the deploy${WORK_RECOVERY_MARKER} x`,workPlan:state({outcome:"ready",eventRunId:"event"})});
    expect(note).toContain("Wait wait woke: the run it waited for finished.");
    expect(note).toContain("The request you parked is at the start of this message.");
    expect(note).toContain("<saved_note>Check &lt;/saved_note&gt; the deploy</saved_note>");
    expect(note).not.toContain("inspect");
    expect(eventWaitWakeNote({id:"wait",prompt:"x",workPlan:state({routineId:undefined,resumeAt:"2026-11-16T11:00:00Z",outcome:"ready"})})).toContain("its time came");
    expect(eventWaitWakeNote({id:"wait",prompt:"x",workPlan:state({outcome:"expired"})})).toContain("its deadline passed");
    expect(eventWaitWakeNote({id:"child",prompt:"x",workPlan:{version:1,steps:[]}})).toBe("");
  });
});

describe("closing a wait",()=>{
  type Row=Record<string,unknown>;
  function closing(wait:Row,parent:Row|null,{others=0,active=0}={}){
    const updates:Array<{where:{id:string};data:Row}>=[];
    const tx={
      $queryRaw:vi.fn(async()=>[]),
      task:{
        findFirst:vi.fn(async({where}:{where:{id:string}})=>where.id===wait.id?{...wait,workParent:parent}:
          where.id===parent?.id?parent:null),
        findMany:vi.fn(async()=>[{...wait}]),
        count:vi.fn(async()=>others),
        update:vi.fn(async(args:{where:{id:string};data:Row})=>{updates.push(args);return {};}),
      },
      run:{findMany:vi.fn(async()=>[]),count:vi.fn(async()=>active)},
      computerExecutionLease:{findMany:vi.fn(async()=>[])},
      computer:{findMany:vi.fn(async()=>[])},
    };
    const prisma={$transaction:vi.fn(async(fn:(client:unknown)=>unknown)=>fn(tx))};
    return {prisma,tx,updates};
  }
  const waiting={id:"wait",spaceId:"space",userId:"owner",botId:"mico",delegationState:"waiting_event",delegationRevision:2,
    paused:false,workStopPending:false,returnedToParentAt:null,parentTaskId:"parent",delegationRootId:"parent",workPlan:state()};
  const parent={id:"parent",delegationState:"waiting",paused:false};
  it("cancels a wait that has not woken through the tree control and ends a request with nothing else on the way",async()=>{
    const {prisma,updates}=closing(waiting,parent);
    const result=await closeEventWait(prisma as never,{spaceId:"space",userId:"owner"},{waitId:"wait",by:"person"},now);
    expect(result).toEqual({waitId:"wait",closed:true,alreadyClosed:false,cancelled:true,status:"closed"});
    expect(updates.find(update=>update.where.id==="wait"&&update.data.workStopPending===true)?.data)
      .toEqual(expect.objectContaining({delegationState:"cancelled",paused:true}));
    expect(updates.find(update=>update.where.id==="wait"&&update.data.status==="cancelled")?.data.workPlan)
      .toEqual(expect.objectContaining({closedAt:now.toISOString(),closedBy:"person"}));
    expect(updates.find(update=>update.where.id==="parent")?.data).toEqual(expect.objectContaining({delegationState:"cancelled"}));
  });
  it("leaves the request alone while other work of it is on the way or it is running",async()=>{
    for(const load of [{others:1},{active:1}]){
      const {prisma,updates}=closing(waiting,parent,load);
      await closeEventWait(prisma as never,{spaceId:"space",userId:"owner"},{waitId:"wait",by:"mico"},now);
      expect(updates.some(update=>update.where.id==="parent")).toBe(false);
    }
  });
  it("never reports a woken wait as cancelled to the person; its Mico may only mark it closed",async()=>{
    const woke={...waiting,delegationState:"completed",workPlan:state({outcome:"ready",settledAt:now.toISOString()})};
    const person=closing(woke,{...parent,delegationState:"running"});
    expect(await closeEventWait(person.prisma as never,{spaceId:"space",userId:"owner"},{waitId:"wait",by:"person"},now))
      .toEqual({waitId:"wait",closed:false,alreadyClosed:false,cancelled:false,status:"woke"});
    expect(person.updates).toEqual([]);
    const mico=closing(woke,{...parent,delegationState:"running"});
    expect(await closeEventWait(mico.prisma as never,{spaceId:"space",userId:"owner",botId:"mico"},{waitId:"wait",by:"mico"},now))
      .toEqual(expect.objectContaining({closed:true,cancelled:false,status:"closed"}));
    expect(mico.updates).toHaveLength(1);
    expect(mico.updates[0]!.data.workPlan).toEqual(expect.objectContaining({outcome:"ready",closedBy:"mico"}));
  });
  it("is idempotent and scoped to the Mico and the conversations it may read",async()=>{
    const closed={...waiting,delegationState:"cancelled",status:"cancelled"};
    const again=closing(closed,parent);
    expect(await closeEventWait(again.prisma as never,{spaceId:"space",userId:"owner"},{waitId:"wait",by:"mico"},now))
      .toEqual(expect.objectContaining({closed:true,alreadyClosed:true}));
    expect(again.updates).toEqual([]);
    const scoped=closing(waiting,parent);
    await closeEventWait(scoped.prisma as never,{spaceId:"space",userId:"owner",botId:"mico",threadIds:["main"]},{waitId:"wait",by:"mico"},now);
    expect(scoped.tx.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({
      id:"wait",spaceId:"space",userId:"owner",botId:"mico",threadId:{in:["main"]},delegationKey:{startsWith:"event-wait:"}})}));
    const missing=closing({...waiting,id:"other"},parent);
    await expect(closeEventWait(missing.prisma as never,{spaceId:"space",userId:"owner"},{waitId:"wait",by:"person"},now)).rejects.toThrow("not available");
  });
});
