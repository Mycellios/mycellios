import { discoverNativeEngines, nativeHostAccess } from "@rakazo/adapters";
import { createTaskControls } from "../task-controls.js";
import { controlWorkTree, workStatus } from "@rakazo/db";
import { reconcileWorkStops } from "@rakazo/adapters";
import type { RouterContext } from "./context.js";

export function localCapabilityRoutes({ authed, deps }: RouterContext) {
  return {
    engines: {
      list: authed.engines.list.handler(async ({ context }) =>
        (await nativeHostAccess(deps.dataDir, context.actor))
          ? discoverNativeEngines(deps.dataDir)
          : [{ id: "pi" as const, name: "Pi", available: true }],
      ),
    },
    tasks: {
      work: authed.tasks.work.handler(({context,input})=>workStatus(deps.prisma,{...context.actor,taskId:input.taskId})),
      controlWork: authed.tasks.controlWork.handler(async({context,input})=>{
        const result=await controlWorkTree(deps.prisma,context.actor,input);
        // Prompt teardown is a best-effort kick. The persistent outbox and worker own
        // completion, so an HTTP response or API restart cannot certify/lose Stop.
        void reconcileWorkStops(deps,context.actor).catch(()=>undefined);
        return {...result,stopping:result.paused};
      }),
      get: authed.tasks.get.handler(({ context, input }) =>
        createTaskControls(deps).get(context.actor, input.runId),
      ),
      control: authed.tasks.control.handler(({ context, input }) =>
        createTaskControls(deps).control(context.actor, input),
      ),
    },
  };
}
