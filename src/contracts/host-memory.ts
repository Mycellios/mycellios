import { z } from "zod";

/** OS observation only; never an allocation grant or hardware attestation. */
export const hostMemoryObservationSchema = z.object({
  schema: z.literal("mycellios-host-memory-observation/1"),
  totalBytes: z.number().int().positive().safe(),
  availableBytes: z.number().int().nonnegative().safe(),
  /** Owner's current contribution ceiling; omission grants no host-backed capacity. */
  offeredBytes: z.number().int().nonnegative().safe().optional(),
  observedAt: z.number().nonnegative().finite(),
}).strict().refine(value => value.availableBytes <= value.totalBytes,
  "Available RAM cannot exceed physical total");

export type HostMemoryObservation = z.infer<typeof hostMemoryObservationSchema>;

/** Independent NTP-synchronized hosts can differ by milliseconds. Never rewrite evidence. */
export function isFreshHostMemory(observation: HostMemoryObservation, now: number): boolean {
  const age = now - observation.observedAt;
  return Number.isFinite(now) && now >= 0 && age >= -1 && age <= 120;
}
