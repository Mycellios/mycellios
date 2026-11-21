/**
 * Counts lease rejections that arrive after a node has already received the
 * request (specs/node-owner-privacy, D2). A node that reads offers and turns
 * most of them down sees far more content than it serves, so a high rejection
 * share is an anomaly. Detection always runs; holding the node back from new
 * offers is opt-in until workers advertise their owner's policy before content
 * is sent, because older workers reject legitimately for that reason.
 */

/** Workers tracked before idle windows are swept. */
const MAX_TRACKED_WORKERS = 10_000;

/** Reasons the coordinator can account for without trusting the node. */
const UNCOUNTED_REASONS = new Set(["duplicate_job"]);

export interface LeaseRejectionMonitorOptions {
  /** Hold anomalous workers back from new offers. Off: report only. */
  enforce?: boolean;
  windowMs?: number;
  minRejections?: number;
  /** Share of offers rejected, above which a worker is anomalous. */
  maxRejectionShare?: number;
  holdMs?: number;
  now?: () => number;
}

export interface LeaseRejectionAnomaly {
  workerId: string;
  offers: number;
  rejections: number;
  held: boolean;
}

interface WorkerWindow {
  offers: number[];
  rejections: number[];
  reportedAt: number | null;
}

export class LeaseRejectionMonitor {
  private readonly windows = new Map<string, WorkerWindow>();
  private readonly holds = new Map<string, number>();
  private readonly enforce: boolean;
  private readonly windowMs: number;
  private readonly minRejections: number;
  private readonly maxRejectionShare: number;
  private readonly holdMs: number;
  private readonly now: () => number;

  constructor(options: LeaseRejectionMonitorOptions = {}) {
    this.enforce = options.enforce ?? false;
    this.windowMs = options.windowMs ?? 60 * 60_000;
    this.minRejections = options.minRejections ?? 3;
    this.maxRejectionShare = options.maxRejectionShare ?? 0.2;
    this.holdMs = options.holdMs ?? 60 * 60_000;
    this.now = options.now ?? Date.now;
  }

  offered(workerId: string): void {
    this.window(workerId).offers.push(this.now());
  }

  /**
   * Records a rejection. `deadlinePassed` lets the caller exempt a
   * deadline_exceeded rejection only when the coordinator agrees the deadline
   * had passed. Returns an anomaly the first time a window crosses the limit.
   */
  rejected(workerId: string, reason: string, deadlinePassed = false): LeaseRejectionAnomaly | null {
    if (UNCOUNTED_REASONS.has(reason) || (reason === "deadline_exceeded" && deadlinePassed)) return null;
    const now = this.now();
    const window = this.window(workerId);
    window.rejections.push(now);
    this.prune(window, now);
    const rejections = window.rejections.length;
    const offers = Math.max(window.offers.length, rejections);
    if (rejections < this.minRejections || rejections / offers <= this.maxRejectionShare) return null;
    if (window.reportedAt !== null && now - window.reportedAt < this.windowMs) return null;
    window.reportedAt = now;
    if (this.enforce) this.holds.set(workerId, now + this.holdMs);
    return { workerId, offers, rejections, held: this.enforce };
  }

  isHeld(workerId: string): boolean {
    const until = this.holds.get(workerId);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.holds.delete(workerId);
    return false;
  }

  /** The connected workers that may receive new offers. */
  offerable(connected: ReadonlySet<string>): ReadonlySet<string> {
    if (this.holds.size === 0) return connected;
    return new Set([...connected].filter((workerId) => !this.isHeld(workerId)));
  }

  private window(workerId: string): WorkerWindow {
    let window = this.windows.get(workerId);
    if (!window) {
      if (this.windows.size >= MAX_TRACKED_WORKERS) this.sweep();
      window = { offers: [], rejections: [], reportedAt: null };
      this.windows.set(workerId, window);
    }
    this.prune(window, this.now());
    return window;
  }

  private sweep(): void {
    const now = this.now();
    for (const [workerId, window] of this.windows) {
      this.prune(window, now);
      const reportedRecently = window.reportedAt !== null && now - window.reportedAt < this.windowMs;
      if (window.offers.length === 0 && window.rejections.length === 0 && !reportedRecently) {
        this.windows.delete(workerId);
      }
    }
  }

  private prune(window: WorkerWindow, now: number): void {
    const since = now - this.windowMs;
    while (window.offers.length > 0 && window.offers[0]! < since) window.offers.shift();
    while (window.rejections.length > 0 && window.rejections[0]! < since) window.rejections.shift();
  }
}
