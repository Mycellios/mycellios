export interface ActivationStartupObservation {
  schema: "mycellios-activation-startup-observation/1";
  scope: "activation-to-first-canary";
  startedAt: number;
  measuredAt: number;
  startupMs: number;
  firstRequestMs: number;
  totalMs: number;
  requestSha256: string;
  outputTokens: number;
  outputSha256?: string;
  outputHashScheme?: "gdlp-output-token-ids-v1";
  reusedKvTokens?: number;
}

/** Timing observation only: process freshness and cold launch qualification are separate. */
export function activationStartupObservation(input: {
  startedAt: number; measuredAt: number; activationStart: number;
  firstRequestStart: number; firstRequestEnd: number;
  metrics: { requestSha256?: string; completionTokens: number; outputTokenIdsSha256?: string;
    outputTokenHashScheme?: "gdlp-output-token-ids-v1"; reusedKvTokens?: number };
}): ActivationStartupObservation {
  const { metrics } = input;
  if (![input.startedAt, input.measuredAt, input.activationStart, input.firstRequestStart,
      input.firstRequestEnd].every(Number.isFinite)
      || input.measuredAt < input.startedAt || input.firstRequestStart < input.activationStart
      || input.firstRequestEnd <= input.firstRequestStart
      || !metrics.requestSha256 || !/^[a-f0-9]{64}$/.test(metrics.requestSha256)
      || !Number.isSafeInteger(metrics.completionTokens) || metrics.completionTokens < 1
      || (metrics.reusedKvTokens !== undefined && (!Number.isSafeInteger(metrics.reusedKvTokens) || metrics.reusedKvTokens < 0))
      || ((metrics.outputTokenIdsSha256 === undefined) !== (metrics.outputTokenHashScheme === undefined))
      || (metrics.outputTokenIdsSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(metrics.outputTokenIdsSha256)
        || metrics.outputTokenHashScheme !== "gdlp-output-token-ids-v1"))) {
    throw new Error("activation_startup_observation_invalid");
  }
  return { schema: "mycellios-activation-startup-observation/1", scope: "activation-to-first-canary",
    startedAt: input.startedAt, measuredAt: input.measuredAt,
    startupMs: input.firstRequestStart-input.activationStart,
    firstRequestMs: input.firstRequestEnd-input.firstRequestStart,
    totalMs: input.firstRequestEnd-input.activationStart, requestSha256: metrics.requestSha256,
    outputTokens: metrics.completionTokens,
    ...(metrics.outputTokenIdsSha256 === undefined ? {} : { outputSha256: metrics.outputTokenIdsSha256,
      outputHashScheme: metrics.outputTokenHashScheme }),
    ...(metrics.reusedKvTokens === undefined ? {} : { reusedKvTokens: metrics.reusedKvTokens }) };
}
