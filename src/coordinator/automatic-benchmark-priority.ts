import type { EventEmitter } from "node:events";

interface CancelledLease { workerId: string; jobId: string; leaseId: string }

/** A scheduler reservation ending does not mean its worker has released execution. */
export function waitForBenchmarkCancellation(
  source: Pick<EventEmitter, "on" | "off">, leases: readonly CancelledLease[], timeoutMs = 45_000,
): Promise<void> {
  if (leases.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const pending = new Set(leases.map(x => `${x.workerId}:${x.jobId}:${x.leaseId}`));
    const finish = (error?: Error) => {
      clearTimeout(timer); source.off("envelope", envelope); source.off("disconnect", disconnected);
      if (error) reject(error); else resolve();
    };
    const envelope = (event: { workerId: string; type: string; payload: { jobId?: string; leaseId?: string } }) => {
      if (!["task.fail", "task.complete", "lease.reject"].includes(event.type)) return;
      pending.delete(`${event.workerId}:${event.payload.jobId}:${event.payload.leaseId}`);
      if (pending.size === 0) finish();
    };
    const disconnected = (workerId: string) => {
      if (leases.some(x => x.workerId === workerId)) finish(new Error("automatic_benchmark_worker_disconnected"));
    };
    const timer = setTimeout(() => finish(new Error("automatic_benchmark_cancellation_timeout")), timeoutMs);
    source.on("envelope", envelope); source.on("disconnect", disconnected);
  });
}

/** Only coordinator-owned automatic probes yield; manual and user jobs remain intact. */
export class AutomaticBenchmarkPriority {
  private readonly requests = new Map<string, { model: string; abort: AbortController }>();
  private readonly foreground = new Map<string, number>();
  private readonly quietUntil = new Map<string, number>();
  constructor(private readonly now = Date.now, private readonly quietMs = 30_000) {}

  deferred(model: string): boolean {
    return (this.foreground.get(model) ?? 0) > 0 || (this.quietUntil.get(model) ?? 0) > this.now();
  }

  /** Give a newly available model an idle window for its first foreground request. */
  deferAfterActivation(model: string): void {
    this.quietUntil.set(model, Math.max(this.quietUntil.get(model) ?? 0, this.now() + this.quietMs));
  }

  running(model: string): boolean {
    return [...this.requests.values()].some(request => request.model === model);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    const model = body.model as string, session = body.session_id as string;
    if (!model || !session || this.requests.has(session)) throw new Error("automatic_benchmark_request_invalid");
    if (this.deferred(model)) throw new Error("automatic_benchmark_yielded_to_foreground");
    const abort = new AbortController();
    this.requests.set(session, { model, abort });
    try {
      return await fetch(input, { ...init, signal: init?.signal
        ? AbortSignal.any([init.signal, abort.signal]) : abort.signal });
    } finally { this.requests.delete(session); }
  };

  async beginForeground(model: string, jobs: readonly { id: string; model: string; sessionId: string;
      workerId?: string | null; leaseId?: string | null }[],
    cancel: (id: string) => boolean | Promise<boolean>): Promise<{ interrupted: number; leases: CancelledLease[]; release(): void }> {
    this.foreground.set(model, (this.foreground.get(model) ?? 0) + 1);
    try {
    let interrupted = 0;
    const leases: CancelledLease[] = [];
    for (const job of jobs) {
      if (job.model === model && this.requests.get(job.sessionId)?.model === model && (await cancel(job.id))) {
        interrupted++;
        if (job.workerId && job.leaseId) leases.push({ workerId: job.workerId, jobId: job.id, leaseId: job.leaseId });
      }
    }
    for (const request of this.requests.values()) {
      if (request.model === model) request.abort.abort(new Error("automatic_benchmark_yielded_to_foreground"));
    }
    let released = false;
    return { interrupted, leases, release: () => {
      if (released) return;
      released = true;
      this.foreground.set(model, Math.max(0, (this.foreground.get(model) ?? 1) - 1));
      this.quietUntil.set(model, this.now() + this.quietMs);
    } };
    } catch (error) {
      this.foreground.set(model, Math.max(0, (this.foreground.get(model) ?? 1) - 1));
      throw error;
    }
  }
}
