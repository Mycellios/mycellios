import { setTimeout as wait } from "node:timers/promises";
import { WorkerRegistrationError } from "./registration-error.js";

/** Retry only transient transport/service failures for a stable reconnecting identity. */
export async function retryWorkerRegistration(
  register: () => Promise<void>, signal: AbortSignal, enabled: boolean,
): Promise<void> {
  let delayMs = 500;
  for (;;) {
    signal.throwIfAborted();
    try { await register(); return; }
    catch (error) {
      if (!enabled || signal.aborted || !transientRegistrationFailure(error)) throw error;
    }
    await wait(delayMs, undefined, { signal });
    delayMs = Math.min(15_000, delayMs * 2);
  }
}

function transientRegistrationFailure(error: unknown): boolean {
  if (error instanceof WorkerRegistrationError) {
    return error.status === 408 || error.status === 429
      || (error.status >= 500 && error.status <= 599);
  }
  return error instanceof Error && (error.name === "TimeoutError"
    || (error instanceof TypeError && error.message === "fetch failed"));
}
