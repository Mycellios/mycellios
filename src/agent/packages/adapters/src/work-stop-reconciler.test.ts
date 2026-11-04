import { describe,expect,it,vi } from 'vitest';
import type { PrismaClient } from '@rakazo/db';
import type { SandboxProvider } from '@rakazo/adapter-kit';
import { reconcileWorkStops } from './work-stop-reconciler.js';
describe('durable work teardown',()=>{
  it('retains failed teardown and retries the exact owned run without releasing a replacement lease',async()=>{
    const task={id:'task',spaceId:'space',userId:'owner',delegationRevision:4,workStopPending:true,
      workStopTargets:{runIds:['old-run'],targets:[{runId:'old-run',botId:'mico',computerId:'pc',fence:7,kind:'desktop',providerRef:'owned-pc',homeKey:'owned-home'}]}};
    const updateMany=vi.fn(async()=>({count:1})),deleteMany=vi.fn(async()=>({count:0}));
    const cancelRunWork=vi.fn().mockRejectedValueOnce(new Error('disconnected')).mockResolvedValue(undefined);
    const prisma={task:{findMany:vi.fn(async()=>[task]),updateMany},run:{findFirst:vi.fn(async()=>({id:'old-run'}))},computerExecutionLease:{deleteMany}} as unknown as PrismaClient;
    const deps={prisma,sandbox:{cancelRunWork} as unknown as SandboxProvider};
    await expect(reconcileWorkStops(deps,{spaceId:'space',userId:'owner'})).rejects.toThrow('remains pending');
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({data:{workStopPending:false}}));expect(deleteMany).not.toHaveBeenCalled();
    await reconcileWorkStops(deps,{spaceId:'space',userId:'owner'});
    expect(cancelRunWork).toHaveBeenLastCalledWith(expect.objectContaining({id:'pc',botId:'mico'}),'pc','old-run',expect.objectContaining({userId:'owner',spaceId:'space',runId:'old-run'}));
    expect(deleteMany).toHaveBeenCalledWith({where:{computerId:'pc',botId:'mico',runId:'old-run',fence:7}});
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({delegationRevision:4,workStopPending:true})}));
  });
});
