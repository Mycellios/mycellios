import { describe, expect, it, vi } from "vitest";
import { eventWaitReceipt, eventWaitState, resolveEventWaitTasks } from "./event-waits.js";

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
