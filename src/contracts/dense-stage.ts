import { z } from "zod";

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/** Portable SafeTensors policy. Admission and timing qualification are separate. */
export const denseStagePolicySchema = z.object({
  schema: z.literal("mycellios-dense-stage/1"),
  precision: z.enum(["float16", "float32"]),
  memoryMode: z.enum(["bounded", "resident"]),
  hostRamBudgetBytes: bytes.positive(),
  vramBudgetBytes: bytes,
  activationReserveBytes: bytes,
  hostTokenLookup: z.boolean(),
  retainLayerPrefix: z.boolean(),
  pinHostStaging: z.boolean().optional(),
  executionTarget: z.literal("cpu").optional(),
}).strict().superRefine((policy, context) => {
  if (policy.executionTarget === "cpu") {
    if (policy.memoryMode !== "resident" || policy.vramBudgetBytes !== 0
        || policy.hostTokenLookup || policy.retainLayerPrefix || policy.pinHostStaging
        || policy.activationReserveBytes >= policy.hostRamBudgetBytes) {
      context.addIssue({ code: "custom", message: "dense_cpu_stage_policy_inconsistent" });
    }
    return;
  }
  if (policy.vramBudgetBytes === 0 || policy.activationReserveBytes >= policy.vramBudgetBytes
      || (policy.memoryMode === "resident"
          && (policy.hostTokenLookup || policy.retainLayerPrefix))) {
    context.addIssue({ code: "custom", message: "dense_stage_policy_inconsistent" });
  }
});

export type DenseStagePolicy = z.infer<typeof denseStagePolicySchema>;

export function validateDenseStagePolicy(stage: {
  dense?: unknown; macroWave?: unknown; execution?: unknown;
  members: readonly unknown[];
}): void {
  if (stage.dense === undefined) return;
  denseStagePolicySchema.parse(stage.dense);
  if (stage.members.length !== 1 || stage.macroWave !== undefined || stage.execution !== undefined) {
    throw new Error("dense_stage_policy_requires_single_standard_stage");
  }
}

export function denseStagePolicyIdentity(policy: DenseStagePolicy | undefined): string {
  return JSON.stringify(policy === undefined ? null : denseStagePolicySchema.parse(policy));
}


