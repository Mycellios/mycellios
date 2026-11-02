import { denseStagePolicySchema, type DenseStagePolicy } from "../contracts/dense-stage.js";
import type { MacroWaveStageExecutionContractV1 } from "./types.js";

export function appendDenseTieringArguments(
  args: string[], contract: MacroWaveStageExecutionContractV1 | null,
  policy?: DenseStagePolicy,
): void {
  if (policy !== undefined) {
    if (contract !== null) throw new Error("dense_stage_policy_conflicts_with_macro_wave");
    const checked = denseStagePolicySchema.parse(policy);
    args.push("--dense-host-ram-budget-bytes", String(checked.hostRamBudgetBytes),
      "--dense-vram-budget-bytes", String(checked.vramBudgetBytes),
      "--dense-activation-reserve-bytes", String(checked.activationReserveBytes),
      "--dense-compute-precision", checked.precision);
    if (checked.memoryMode === "resident") args.push("--dense-require-full-residency");
    if (checked.hostTokenLookup) args.push("--dense-host-token-lookup");
    if (checked.retainLayerPrefix) args.push("--dense-retain-layer-prefix");
    if (checked.pinHostStaging) args.push("--dense-pin-host-staging");
    if (checked.executionTarget === "cpu") args.push("--dense-execution-target", "cpu");
    return;
  }
  if (contract === null || contract.residentKind !== "layers" || contract.ramArtifact !== undefined) return;
  args.push("--dense-host-ram-budget-bytes", String(contract.budgets.hostRamBytes),
    "--dense-vram-budget-bytes", String(contract.budgets.vramBytes),
    "--dense-activation-reserve-bytes", String(contract.requirements.activationBufferBytes));
  if (contract.memoryMode === "resident") args.push("--dense-require-full-residency");
}

export function validateDenseStageBackend(policy: DenseStagePolicy | undefined,
  alternatives: readonly unknown[]): void {
  if (policy !== undefined && alternatives.some(Boolean)) {
    throw new Error("dense_stage_policy_requires_standard_safetensors_stage");
  }
}

/** RPC must preserve the sealed policy, including flag multiplicity and values. */
export function validateDenseStageCommand(policy: unknown, command: unknown): void {
  const checked = denseStagePolicySchema.parse(policy);
  if (command === null || typeof command !== "object"
      || !Array.isArray((command as { args?: unknown }).args)) {
    throw new Error("python_launch_dense_command_is_invalid");
  }
  const args = (command as { args: unknown[] }).args;
  const expected: string[] = [];
  appendDenseTieringArguments(expected, null, checked);
  const actual: unknown[] = [];
  const switches = new Set(["--dense-require-full-residency", "--dense-host-token-lookup", "--dense-retain-layer-prefix", "--dense-pin-host-staging"]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (typeof flag !== "string" || !flag.startsWith("--dense-")) continue;
    actual.push(flag);
    if (!switches.has(flag)) actual.push(args[++index]);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("python_launch_dense_command_policy_mismatch");
  }
  if (checked.executionTarget === "cpu") {
    const devices = args.flatMap((flag, index) => flag === "--device" ? [args[index + 1]] : []);
    if (devices.length !== 1 || devices[0] !== "cpu") {
      throw new Error("python_launch_dense_cpu_device_mismatch");
    }
  }
}

export function validateDenseRpcStage(stage: Record<string, unknown>): void {
  if (stage.dense === undefined) return;
  validateDenseStageCommand(stage.dense, stage.command);
  if (stage.kind === "cell-member" || stage.macroWave !== null
      || stage.nativeGguf !== null || stage.cell != null
      || !Array.isArray(stage.members) || stage.members.length !== 1) {
    throw new Error("python_launch_dense_requires_single_standard_stage");
  }
}


