/** Bounds heartbeat latency without launching duplicate probes when a reader hangs. */
export class HeartbeatObservation<T> {
  private pending: Promise<T | null> | null = null;

  async read(reader: () => Promise<T>, timeoutMs = 1_000): Promise<T | null> {
    if (!this.pending) {
      const pending = Promise.resolve().then(reader).catch(() => null);
      this.pending = pending;
      void pending.then(() => { if (this.pending === pending) this.pending = null; });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.pending,
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
