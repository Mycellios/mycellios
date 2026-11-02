/** Current authenticated activation only. The owner must bind exact native source,
 * launch authority, peer stream identities and the original root health snapshot.
 * This lease never grants scheduling/admission and cannot resume a failed job. */
export interface WarmRouteRecoveryLease {
  isCurrent(): boolean;
  inspect(signal: AbortSignal): Promise<"ready" | "recovering" | "invalid">;
}

interface PendingRecovery {
  lease: WarmRouteRecoveryLease;
  reason: string;
  abort: AbortController;
  deadline: ReturnType<typeof setTimeout>;
  poll?: ReturnType<typeof setTimeout>;
}

/** Bounded opportunity to keep a qualified loaded route; unknown routes repair
 * immediately. Security eviction and explicit stop must call invalidate(). */
export class WarmRouteRecovery {
  private readonly pending = new Map<string, PendingRecovery>();
  private closed = false;

  constructor(private readonly repair: (model: string, reason: string) => void,
    private readonly options: { windowMs?: number; pollMs?: number } = {}) {
    const window = options.windowMs ?? 10_000;
    const poll = options.pollMs ?? 250;
    if (!Number.isInteger(window) || window < 1 || window > 10_000
        || !Number.isInteger(poll) || poll < 1 || poll > window) {
      throw new RangeError("invalid_warm_route_recovery_bounds");
    }
  }

  request(model: string, reason: string, lease?: WarmRouteRecoveryLease): void {
    if (this.closed) return;
    const existing = this.pending.get(model);
    if (existing && this.current(existing.lease)) return;
    if (existing) this.cancel(model, existing);
    if (!lease) { this.repair(model, reason); return; }
    if (!this.current(lease)) return;
    const pending: PendingRecovery = {
      lease, reason, abort: new AbortController(),
      deadline: setTimeout(() => this.fail(model, pending, "deadline"), this.options.windowMs ?? 10_000),
    };
    this.pending.set(model, pending);
    // Synchronous capture precedes disconnect/degraded callbacks. Actual inspection
    // waits until transport suspension has finished in the current event turn.
    queueMicrotask(() => { void this.inspect(model, pending); });
  }

  hasPending(model: string): boolean { return this.pending.has(model); }

  invalidate(model: string, reason: string): void {
    if (this.closed) return;
    const pending = this.pending.get(model);
    if (pending) this.cancel(model, pending);
    this.repair(model, reason);
  }

  cancelModel(model: string): void {
    const pending = this.pending.get(model);
    if (pending) this.cancel(model, pending);
  }

  close(): void {
    this.closed = true;
    for (const [model, pending] of this.pending) this.cancel(model, pending);
  }

  private current(lease: WarmRouteRecoveryLease): boolean {
    try { return lease.isCurrent(); } catch { return false; }
  }

  private owns(model: string, pending: PendingRecovery): boolean {
    return !this.closed && this.pending.get(model) === pending;
  }

  private cancel(model: string, pending: PendingRecovery): void {
    if (this.pending.get(model) !== pending) return;
    this.pending.delete(model);
    clearTimeout(pending.deadline);
    if (pending.poll) clearTimeout(pending.poll);
    pending.abort.abort();
  }

  private fail(model: string, pending: PendingRecovery, detail: string): void {
    if (!this.owns(model, pending)) return;
    const current = this.current(pending.lease);
    this.cancel(model, pending);
    // An old lease must never tear down a newer activation.
    if (current) this.repair(model, `${pending.reason}:warm_recovery_${detail}`);
  }

  private async inspect(model: string, pending: PendingRecovery): Promise<void> {
    if (!this.owns(model, pending)) return;
    if (!this.current(pending.lease)) { this.cancel(model, pending); return; }
    let result: "ready" | "recovering" | "invalid";
    try { result = await pending.lease.inspect(pending.abort.signal); }
    catch { this.fail(model, pending, "probe_failed"); return; }
    if (!this.owns(model, pending)) return;
    if (!this.current(pending.lease)) { this.cancel(model, pending); return; }
    if (result === "ready") { this.cancel(model, pending); return; }
    if (result !== "recovering") { this.fail(model, pending, "invalid"); return; }
    pending.poll = setTimeout(() => { void this.inspect(model, pending); }, this.options.pollMs ?? 250);
  }
}
