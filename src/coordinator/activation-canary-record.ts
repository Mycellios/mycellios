import { createHash } from "node:crypto";
import type { AutoDistributionRunResult } from "../distribution/auto-distribute.js";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const sampleSchema = z.object({
  sampleId: z.string().min(1), requestSha256: digest,
  outputTokens: z.number().int().positive().safe(), completed: z.literal(true),
  totalRequestMs: z.number().positive().finite(), measuredAt: z.number().finite(),
  outputSha256: digest, outputHashScheme: z.literal("gdlp-output-token-ids-v1"),
  reusedKvTokens: z.number().int().nonnegative().safe(),
}).passthrough();

/** Internal stored observations only. This never converts warmed receipts to cold launches. */
export function qualifiedWarmCanarySamples(record: unknown, reference: {
  launchDescriptionSha256: string; requestSha256: string; outputSha256: string;
  outputTokens: number; reusedKvTokens: number;
}, now = Date.now() / 1000): z.infer<typeof sampleSchema>[] {
  const parsed = z.object({ passed: z.literal(true), measurementIdentity: z.object({
    schema: z.literal("mycellios-activation-canary-observation/1"),
    phase: z.literal("post-warmup-canary"), launchDescriptionSha256: digest,
  }).passthrough(), samples: z.array(z.unknown()) }).passthrough().safeParse(record);
  if (!parsed.success || !Number.isFinite(now)
      || parsed.data.measurementIdentity.launchDescriptionSha256 !== reference.launchDescriptionSha256) return [];
  const unique = new Map<string, z.infer<typeof sampleSchema>>();
  for (const row of parsed.data.samples) {
    const sample = sampleSchema.safeParse(row);
    if (!sample.success) continue;
    const value = sample.data, age = now - value.measuredAt;
    if (age < 0 || age > 3600 || value.requestSha256 !== reference.requestSha256
        || value.outputSha256 !== reference.outputSha256 || value.outputTokens !== reference.outputTokens
        || value.reusedKvTokens !== reference.reusedKvTokens) continue;
    if (unique.has(value.sampleId)) return [];
    unique.set(value.sampleId, value);
  }
  return unique.size >= 3 ? structuredClone([...unique.values()]) : [];
}

/** Called only with the server-owned result after health, canary and execution checks. */
export function activationCanaryRecord(result: AutoDistributionRunResult): Record<string, unknown> {
  return structuredClone({
    passed: true,
    text: result.canaryText,
    ...result.canaryMetrics,
    workerId: result.workerId,
    measurementIdentity: {
      schema: "mycellios-activation-canary-observation/1",
      launchId: result.launch.launchId,
      pipelineId: result.launch.pipelineId,
      model: result.launch.modelIdentity,
      launchDescriptionSha256: createHash("sha256")
        .update(JSON.stringify(result.launch)).digest("hex"),
      /** Samples follow warmup; neither cold cost nor hardware attestation is inferred. */
      phase: "post-warmup-canary",
    },
    ...(result.canaryEvidence === undefined ? {} : { samples: result.canaryEvidence }),
    ...(result.activationStartupObservation === undefined ? {} : { startupObservation: result.activationStartupObservation }),
    ...(result.observedExecution === undefined ? {} : { observedExecution: result.observedExecution }),
  });
}
