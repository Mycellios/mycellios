import { z } from "zod";
import { denseStagePolicySchema } from "../contracts/dense-stage.js";

const phase = z.object({ stages: z.array(z.object({
  nodeId: z.string().min(1), dense: denseStagePolicySchema.optional(),
}).passthrough()).min(1) }).passthrough();
const phases = z.object({ prefill: phase, decode: phase }).passthrough();

/** Prune only current capacity failures before compiling remaining candidates. */
export function denseCandidateFitsCurrentCapacity(
  plans: unknown,
  capacities: ReadonlyMap<string, { hostBytes: number; graphicsBytes: number }>,
): boolean {
  const checked = phases.parse(plans);
  for (const plan of [checked.prefill, checked.decode]) {
    const totals = new Map<string, { hostBytes: number; graphicsBytes: number }>();
    for (const stage of plan.stages) {
      if (!stage.dense) continue;
      const capacity = capacities.get(stage.nodeId);
      if (!capacity) throw new Error("measured_catalog_launch_mismatch");
      if (!Number.isFinite(capacity.hostBytes) || capacity.hostBytes < 0
          || !Number.isFinite(capacity.graphicsBytes) || capacity.graphicsBytes < 0) return false;
      const total = totals.get(stage.nodeId) ?? { hostBytes: 0, graphicsBytes: 0 };
      total.hostBytes += stage.dense.hostRamBudgetBytes;
      total.graphicsBytes += stage.dense.vramBudgetBytes;
      totals.set(stage.nodeId, total);
      if (total.hostBytes > capacity.hostBytes
          || total.graphicsBytes > capacity.graphicsBytes) return false;
    }
  }
  return true;
}
