import {expect,it,vi} from 'vitest';
import type {Actor} from '@mycellios/contracts';
const control=vi.hoisted(()=>vi.fn());
vi.mock('@mycellios/db',async original=>({...await original<object>(),controlWorkTree:control}));
vi.mock('@mycellios/adapters',async original=>({...await original<object>(),reconcileWorkStops:vi.fn(async()=>undefined)}));
import {stopWorkForThread} from './work-controls.js';
it('composer Stop finds a waiting coordinator even when its provider turn already completed',async()=>{
  let active=true;control.mockImplementation(async()=>{active=false;return {};});
  const findMany=vi.fn(async()=>active?[{id:'parent',delegationRevision:3}]:[]);
  const actor={spaceId:'space',userId:'owner'} as Actor;
  await stopWorkForThread({prisma:{task:{findMany}}} as never,actor,'coordinator-thread');
  expect(findMany.mock.calls[0]![0]).toEqual(expect.objectContaining({where:expect.objectContaining({spaceId:'space',userId:'owner',threadId:'coordinator-thread',createdAt:{lte:expect.any(Date)}})}));
  expect(control).toHaveBeenCalledWith(expect.anything(),actor,{taskId:'parent',expectedRevision:3,action:'cancel'});
});
it('archive keeps a request parked only on event waits, but stops one that also waits for other work',async()=>{
  control.mockReset();control.mockImplementation(async()=>({}));
  const wait={delegationState:'waiting_event',workPlan:{version:1,kind:'event-wait',openedAt:'2026-11-22T10:00:00Z',expiresAt:'2026-11-23T10:00:00Z',routineId:'routine'}};
  const rows=[
    {id:'parked',delegationRevision:1,delegationState:'waiting',workChildren:[wait,{delegationState:'completed',workPlan:null}]},
    {id:'mixed',delegationRevision:2,delegationState:'waiting',workChildren:[wait,{delegationState:'running',workPlan:null}]},
  ];
  let pass=0;const findMany=vi.fn(async()=>pass++?rows.slice(0,1):rows);
  const actor={spaceId:'space',userId:'owner'} as Actor;
  await stopWorkForThread({prisma:{task:{findMany}}} as never,actor,'side',{keepEventWaits:true});
  expect(control).toHaveBeenCalledTimes(1);
  expect(control).toHaveBeenCalledWith(expect.anything(),actor,{taskId:'mixed',expectedRevision:2,action:'cancel'});
  expect(findMany.mock.calls[0]![0]).toEqual(expect.objectContaining({include:{workChildren:{select:{delegationState:true,workPlan:true}}}}));
});
it('Stop still cancels a request parked on an event wait',async()=>{
  control.mockReset();let active=true;control.mockImplementation(async()=>{active=false;return {};});
  const findMany=vi.fn(async()=>active?[{id:'parked',delegationRevision:4,delegationState:'waiting'}]:[]);
  await stopWorkForThread({prisma:{task:{findMany}}} as never,{spaceId:'space',userId:'owner'} as Actor,'side');
  expect(control).toHaveBeenCalledWith(expect.anything(),expect.anything(),{taskId:'parked',expectedRevision:4,action:'cancel'});
});
