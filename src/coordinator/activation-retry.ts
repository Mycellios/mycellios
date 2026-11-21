export const DEFAULT_AUTOMATIC_ACTIVATION_RETRY_DELAYS_MS = [
  5_000,
  15_000,
  30_000,
  120_000,
  300_000,
] as const;

export interface AutomaticActivationRetryState {
  retryCount: number;
  nextAttemptAt: number;
  lastError: string;
  updatedAt: number;
  launching: boolean;
}

/**
 * Transient activation failures never give up permanently: after the initial
 * progressive burst, retries continue at the last (largest) configured delay
 * while the failure stays transient. Capacity, activation-slot and planner
 * admission still gate every launch; only an empty schedule disables retries.
 */
export function nextAutomaticActivationRetry(
  retriesStarted: number,
  message: string,
  now = Date.now(),
  delays: readonly number[] = DEFAULT_AUTOMATIC_ACTIVATION_RETRY_DELAYS_MS,
): AutomaticActivationRetryState | null {
  if (delays.length === 0) return null;
  const delay = delays[Math.min(Math.max(0, retriesStarted), delays.length - 1)]!;
  return {
    retryCount: retriesStarted,
    nextAttemptAt: now + Math.max(0, delay),
    lastError: message,
    updatedAt: now,
    launching: false,
  };
}

/** Human label for one retry: counted within the burst, persistent afterwards. */
export function automaticRetryLabel(retryNumber: number, delays: readonly number[]): string {
  const burst = delays.length;
  if (retryNumber <= burst) return `Automatic retry ${retryNumber} of ${burst}`;
  const intervalSeconds = Math.round((delays.at(-1) ?? 0) / 1_000);
  return `Persistent automatic retry ${retryNumber} (every ${intervalSeconds}s while the failure stays transient)`;
}
