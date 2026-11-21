/**
 * Coordinator-measured service speed (specs/node-owner-privacy, D2 phase 2b).
 *
 * Nodes report their own throughput and first-token time, and the scheduler
 * ranks them with those claims. A node that overstates them would win every
 * offer. After each completed job the coordinator compares how long the job
 * really took with what the node's claims predicted. Once a few jobs show a
 * node is slower than it claims, its claims are scaled down by that ratio.
 * A node that claims less than it delivers gains nothing: the factor never
 * goes below 1, so honest claims are never adjusted.
 */

const MIN_SAMPLES = 3;
const MAX_SAMPLES = 5;
const MAX_FACTOR = 20;
const SAMPLE_TTL_MS = 6 * 60 * 60_000;
const MAX_TRACKED = 10_000;
/** Below this, network and scheduling noise dominate the prediction. */
const MIN_PREDICTED_MS = 50;

interface Sample {
  ratio: number;
  at: number;
}

export interface ServiceObservation {
  workerId: string;
  deploymentId: string;
  observedMs: number;
  predictedMs: number;
}

export class MeasuredServiceRates {
  private readonly samples = new Map<string, Sample[]>();

  constructor(private readonly now: () => number = Date.now) {}

  record(observation: ServiceObservation): void {
    const { observedMs, predictedMs } = observation;
    if (!Number.isFinite(observedMs) || !Number.isFinite(predictedMs) || observedMs < 0 || predictedMs <= 0) return;
    const key = serviceKey(observation.workerId, observation.deploymentId);
    const list = this.fresh(key);
    if (!this.samples.has(key) && this.samples.size >= MAX_TRACKED) this.sweep();
    list.push({ ratio: observedMs / Math.max(predictedMs, MIN_PREDICTED_MS), at: this.now() });
    while (list.length > MAX_SAMPLES) list.shift();
    this.samples.set(key, list);
  }

  /**
   * How much slower than claimed this deployment has been: the median of its
   * recent observed/predicted ratios, between 1 and MAX_FACTOR. 1 until there
   * are enough recent samples.
   */
  factor(workerId: string, deploymentId: string): number {
    const list = this.fresh(serviceKey(workerId, deploymentId));
    if (list.length < MIN_SAMPLES) return 1;
    const sorted = list.map((sample) => sample.ratio).sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
    return Math.min(MAX_FACTOR, Math.max(1, median));
  }

  private fresh(key: string): Sample[] {
    const since = this.now() - SAMPLE_TTL_MS;
    const list = (this.samples.get(key) ?? []).filter((sample) => sample.at >= since);
    if (list.length === 0) this.samples.delete(key);
    return list;
  }

  private sweep(): void {
    for (const key of [...this.samples.keys()]) this.fresh(key);
    while (this.samples.size >= MAX_TRACKED) {
      const oldest = this.samples.keys().next().value;
      if (oldest === undefined) break;
      this.samples.delete(oldest);
    }
  }
}

function serviceKey(workerId: string, deploymentId: string): string {
  return `${workerId}\n${deploymentId}`;
}

/** The time a deployment's own claims predict for `outputTokens` tokens. */
export function predictedServiceMs(
  claims: { ttftMs: number; tokensPerSecond: number },
  outputTokens: number,
  generatesText: boolean,
): number {
  const generationMs = generatesText && claims.tokensPerSecond > 0 ? (outputTokens / claims.tokensPerSecond) * 1_000 : 0;
  return claims.ttftMs + generationMs;
}
