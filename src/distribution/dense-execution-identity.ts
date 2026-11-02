import { createHash } from "node:crypto";
import { validatePythonLaunchDescription, type PythonPipelineLaunchDescription } from "./python-launcher.js";

// Estimates do not configure native execution. The compiler must recheck current
// route availability before hashing; its feasibility decision, memory,
// calibration requirements/reasons and unknown future fields stay bound.
const estimateFields = ["ttftMs", "tpotMs", "tokensPerSecondPerSequence",
  "aggregateTokensPerSecond", "responseTimeMs", "pipelineCycleMs", "pathDecodeMs",
  "tokenReturnMs", "energyWhPerOutputToken", "routeAvailability"] as const;
const stageTimingFields = ["decodeBatchComputeMs", "decodeOutgoingMs",
  "prefillOutgoingMs", "prefillChunkComputeMs"] as const;

/** Validate the full description before projecting only nonexecuting estimates. */
export function denseExecutableLaunchIdentity(launch: PythonPipelineLaunchDescription): unknown {
  validatePythonLaunchDescription(launch);
  const { launchId: _derivedIdentity, ...value } = structuredClone(launch);
  for (const plan of Object.values(value.sourceManifest.plans)) {
    const predicted = plan.predicted as unknown as Record<string, unknown>;
    for (const field of estimateFields) delete predicted[field];
    for (const metrics of plan.predicted.stageMetrics) {
      const record = metrics as unknown as Record<string, unknown>;
      for (const field of stageTimingFields) delete record[field];
    }
  }
  return value;
}

export function denseExecutableLaunchSha256(launch: PythonPipelineLaunchDescription): string {
  return createHash("sha256").update(JSON.stringify(denseExecutableLaunchIdentity(launch))).digest("hex");
}
