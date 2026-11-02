import { z } from "zod";
import type { RuntimePipelineManifestV2 } from "./runtime-manifest.js";

export const stagePackageBindingsSchema = z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/));
/** Package verification remains mandatory in Python before loading tensors. */
export function normalizeStagePackageBindings(value: unknown, manifest: RuntimePipelineManifestV2): Record<string,string> {
  const checked = stagePackageBindingsSchema.parse(value);
  const stages = manifest.plans.decode.stages;
  const owners = [...new Set(stages.map(stage=>stage.anchor.memberId))].sort();
  if (JSON.stringify(Object.keys(checked).sort()) !== JSON.stringify(owners)
      || stages.some(stage=>stage.members.length !== 1 || stage.dense === undefined)) {
    throw new Error("python_stage_package_bindings_require_complete_dense_coverage");
  }
  return {...checked};
}

export function appendStagePackageIdentity(args: string[], bindings: Record<string,string> | undefined, nodeId: string): void {
  if (bindings === undefined) return;
  const identity=bindings[nodeId];
  if (!identity) throw new Error("python_stage_package_binding_missing");
  args.push("--stage-package-identity",identity);
}
