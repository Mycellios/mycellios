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

/** Registration always stays compatible with coordinators predating this field. */
export function withoutHostMemory<T extends { hostMemory?: unknown }>(capabilities: T): Omit<T, "hostMemory"> {
  const { hostMemory: _observation, ...legacy } = capabilities;
  return legacy;
}
