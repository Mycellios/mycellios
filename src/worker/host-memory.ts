import { freemem, totalmem } from "node:os";
import { hostMemoryObservationSchema, type HostMemoryObservation } from "../contracts/host-memory.js";

export function observeHostMemory(offeredBytes?: number): HostMemoryObservation | undefined {
  const observation = hostMemoryObservationSchema.safeParse({
    schema: "mycellios-host-memory-observation/1",
    totalBytes: totalmem(), availableBytes: freemem(), observedAt: Date.now() / 1000,
    ...(offeredBytes === undefined ? {} : { offeredBytes }),
  });
  return observation.success ? observation.data : undefined;
}

/**
 * Registration always stays compatible with coordinators predating these
 * optional heartbeat observations, and they never alter the signed identity.
 */
export function withoutDynamicObservations<T extends { hostMemory?: unknown; artifactSeed?: unknown }>(
  capabilities: T,
): Omit<T, "hostMemory" | "artifactSeed"> {
  const { hostMemory: _observation, artifactSeed: _seed, ...legacy } = capabilities;
  return legacy;
}
