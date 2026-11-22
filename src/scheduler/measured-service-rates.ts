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

export interface ThroughputObservation {
  workerId: string;
  deploymentId: string;
  /** Coordinator-estimated input tokens of the completed batch. */
  tokens: number;
  /** Wall time from the offer to the validated result, as the coordinator saw it. */
  observedMs: number;
  /** Fixed per-request cost (lease, transport) excluded from the rate. */
  overheadMs: number;
}

/** Half of each new observation enters the average, so a throttled device shrinks quickly. */
const THROUGHPUT_WEIGHT = 0.5;
const MIN_THROUGHPUT = 0.5;
const MAX_THROUGHPUT = 50_000;

export class MeasuredServiceRates {
  private readonly samples = new Map<string, Sample[]>();
  private readonly throughput = new Map<string, { tokensPerSecond: number; at: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Batch input throughput (memory embeddings) measured by the coordinator.
   * Unlike `factor`, this may also rise above the node's claims: the node only
   * gets larger pieces after it has actually returned validated work faster.
   */
  recordThroughput(observation: ThroughputObservation): void {
    const { tokens, observedMs, overheadMs } = observation;
    if (!Number.isFinite(tokens) || !Number.isFinite(observedMs) || tokens <= 0 || observedMs <= 0) return;
    // A fast answer cannot claim more than twice its raw speed by hiding inside the overhead.
    const seconds = Math.max(0.05, observedMs / 2_000, (observedMs - Math.max(0, overheadMs)) / 1_000);
    const measured = Math.min(MAX_THROUGHPUT, Math.max(MIN_THROUGHPUT, tokens / seconds));
    const key = serviceKey(observation.workerId, observation.deploymentId);
    const previous = this.currentThroughput(key);
    if (previous === null && !this.throughput.has(key) && this.throughput.size >= MAX_TRACKED) {
      const oldest = this.throughput.keys().next().value;
      if (oldest !== undefined) this.throughput.delete(oldest);
    }
    this.throughput.delete(key);
    this.throughput.set(key, {
      tokensPerSecond: previous === null ? measured : previous + THROUGHPUT_WEIGHT * (measured - previous),
      at: this.now(),
    });
  }

  /** Recently measured input tokens per second, or null before any fresh measurement. */
  throughputTokensPerSecond(workerId: string, deploymentId: string): number | null {
    return this.currentThroughput(serviceKey(workerId, deploymentId));
  }

  private currentThroughput(key: string): number | null {
    const entry = this.throughput.get(key);
    if (!entry) return null;
    if (entry.at < this.now() - SAMPLE_TTL_MS) {
      this.throughput.delete(key);
      return null;
    }
    return entry.tokensPerSecond;
  }

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
