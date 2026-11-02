import { createHash } from "node:crypto";
import { z } from "zod";
import type { PythonPipelineLaunchDescription } from "./python-launcher.js";
import { selectMeasuredDenseRoute, type DenseMeasuredSelection } from "./dense-measured-routing.js";
import { denseExecutableLaunchIdentity } from "./dense-execution-identity.js";
import { planFleetResourceRoles, type FleetResourceEvidence, type FleetResourcePlan } from "./fleet-resource-roles.js";

type SelectedRoute = NonNullable<DenseMeasuredSelection["selected"]>;

const inventorySchema = z.object({ devices: z.array(z.object({
  id: z.string().min(1), connected: z.boolean(), observedAt: z.number().finite().nonnegative(),
}).passthrough()) }).passthrough();

function currentResources(document: unknown): FleetResourceEvidence {
  return { demands: [], nodes: inventorySchema.parse(document).devices.map(device => ({
    nodeId: device.id, connected: device.connected, enabled: true,
    observedAtMs: device.observedAt * 1_000,
  })) };
}

/** Binds costs to executable arguments, precision, memory and checkpoint source. */
export function denseLaunchExecutionKey(
  launch: PythonPipelineLaunchDescription,
  stages: SelectedRoute["stages"],
): string {
  return createHash("sha256").update(JSON.stringify({
    schema: "mycellios-measured-dense-launch/3", launch: denseExecutableLaunchIdentity(launch), stages,
  })).digest("hex");
}

/** Returns an immutable selected launch for a new request, never an active KV reroute. */
export async function selectMeasuredDenseLaunch(
  document: unknown,
  runtime: Parameters<typeof selectMeasuredDenseRoute>[1],
  launches: ReadonlyMap<string, PythonPipelineLaunchDescription>,
  resources?: FleetResourceEvidence,
): Promise<{ selection: DenseMeasuredSelection; launch: PythonPipelineLaunchDescription | null; resourceRoles: FleetResourcePlan | null }> {
  const selection = await selectMeasuredDenseRoute(document, runtime);
  const selected = selection.selected;
  if (selected === null) return { selection, launch: null, resourceRoles: null };
  const source = launches.get(selected.candidateId);
  if (!source) throw new Error("dense_selected_launch_missing");
  // Snapshot before validation, so callers cannot mutate the checked executable.
  const launch = structuredClone(source);
  if (denseLaunchExecutionKey(launch, selected.stages) !== selected.executionKey) {
    throw new Error("dense_selected_launch_identity_mismatch");
  }
  const processes = launch.launchOrder.filter((entry) => entry.kind !== "cell-member")
    .sort((a, b) => a.stageIndex - b.stageIndex);
  if (processes.length !== selected.stages.length) throw new Error("dense_selected_launch_stage_mismatch");
  for (const [index, process] of processes.entries()) {
    const stage = selected.stages[index]!;
    if (process.members.length !== 1 || process.anchor.memberId !== stage.deviceId
        || process.layerStart !== stage.layerStart || process.layerEnd !== stage.layerEnd
        || process.totalLayers !== launch.totalLayers
        || (!process.dense && process.members[0]!.assignedMemoryBytes > stage.hostBytes)
        || stage.residency !== "cold-launch") {
      throw new Error("dense_selected_launch_stage_mismatch");
    }
    if (process.macroWave && (process.macroWave.requirements.hostRamBytes > stage.hostBytes
        || process.macroWave.requirements.vramBytes > stage.vramBytes)) {
      throw new Error("dense_selected_launch_memory_mismatch");
    }
    if (process.dense && (process.dense.hostRamBudgetBytes > stage.hostBytes
        || process.dense.vramBudgetBytes > stage.vramBytes)) {
      throw new Error("dense_selected_launch_memory_mismatch");
    }
  }
  const resourceRoles = planFleetResourceRoles(
    selected.stages.map(stage => stage.deviceId), resources ?? currentResources(document),
  );
  return { selection, launch, resourceRoles };
}
