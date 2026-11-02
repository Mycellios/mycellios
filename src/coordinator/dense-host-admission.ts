import { hostMemoryObservationSchema, isFreshHostMemory } from "../contracts/host-memory.js";
import type { PythonPipelineLaunchDescription } from "../distribution/python-launcher.js";

/** Additional cold host check; native executors still recheck OS/GPU budgets. */
export function denseHostAdmissionAllows(
  launch: PythonPipelineLaunchDescription, nodeId: string,
  hostMemory: unknown, now = Date.now() / 1000,
): boolean {
  const processes = launch.launchOrder.filter(process => process.anchor.memberId === nodeId && process.dense);
  if (processes.length === 0) return true;
  const observed = hostMemoryObservationSchema.safeParse(hostMemory);
  if (!observed.success || !Number.isFinite(now)) return false;
  if (!isFreshHostMemory(observed.data, now)) return false;
  const required = processes.reduce((sum, process) => sum + process.dense!.hostRamBudgetBytes, 0);
  return Number.isSafeInteger(required) && required > 0
    && required <= Math.min(observed.data.availableBytes, observed.data.offeredBytes ?? 0);
}
