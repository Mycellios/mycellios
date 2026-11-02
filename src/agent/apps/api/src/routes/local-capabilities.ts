import { discoverNativeEngines, nativeHostAccess } from "@rakazo/adapters";
import { createTaskControls } from "../task-controls.js";
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
      get: authed.tasks.get.handler(({ context, input }) =>
        createTaskControls(deps).get(context.actor, input.runId),
      ),
      control: authed.tasks.control.handler(({ context, input }) =>
        createTaskControls(deps).control(context.actor, input),
      ),
    },
  };
}
