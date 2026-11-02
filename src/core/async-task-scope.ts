/** Own asynchronous work started by APIs that ignore returned promises. */
export class AsyncTaskScope {
  private readonly pending = new Set<Promise<void>>();
  private readonly tails = new Map<unknown, Promise<void>>();
  private failure: unknown;
  private failed = false;
  private closed = false;

  constructor(private readonly report: (label: string, error: unknown) => void) {}

  run(label: string, action: () => unknown | Promise<unknown>, serialKey?: unknown): void {
    if (this.closed) return;
    const previous = serialKey === undefined ? Promise.resolve() : this.tails.get(serialKey) ?? Promise.resolve();
    const task = previous.then(action).then(() => undefined).catch(error => {
      if (!this.failed) this.failure = error;
      this.failed = true;
      try { this.report(label, error); } catch { /* Reporting cannot create a second unhandled rejection. */ }
    });
    const settled = task.finally(() => {
      this.pending.delete(settled);
      if (serialKey !== undefined && this.tails.get(serialKey) === settled) this.tails.delete(serialKey);
    });
    this.pending.add(settled);
    if (serialKey !== undefined) this.tails.set(serialKey, settled);
  }

  async drain(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
    if (this.failed) {
      const error = this.failure;
      this.failed = false;
      this.failure = undefined;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.drain();
  }
}

/** Share one in-flight reconciliation across timer and realtime callers. */
export function coalesceAsync<T>(action: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => pending ??= Promise.resolve().then(action).finally(() => { pending = null; });
}
