import {expect,it,vi} from 'vitest';
import type {Actor} from '@rakazo/contracts';
const control=vi.hoisted(()=>vi.fn());
vi.mock('@rakazo/db',async original=>({...await original<object>(),controlWorkTree:control}));
vi.mock('@rakazo/adapters',async original=>({...await original<object>(),reconcileWorkStops:vi.fn(async()=>undefined)}));
import {stopWorkForThread} from './work-controls.js';
it('composer Stop finds a waiting coordinator even when its provider turn already completed',async()=>{
  let active=true;control.mockImplementation(async()=>{active=false;return {};});
  const findMany=vi.fn(async()=>active?[{id:'parent',delegationRevision:3}]:[]);
  const actor={spaceId:'space',userId:'owner'} as Actor;
  await stopWorkForThread({prisma:{task:{findMany}}} as never,actor,'coordinator-thread');
  expect(findMany.mock.calls[0]![0]).toEqual(expect.objectContaining({where:expect.objectContaining({spaceId:'space',userId:'owner',threadId:'coordinator-thread',createdAt:{lte:expect.any(Date)}})}));
  expect(control).toHaveBeenCalledWith(expect.anything(),actor,{taskId:'parent',expectedRevision:3,action:'cancel'});
});
