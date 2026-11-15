import WebSocket from "ws";

const PAYLOAD = Buffer.from("gdlp-rtt");
const EMA_ALPHA = 0.2;

/** One monotonic ping at a time, shared by measurement and transport liveness. */
export class CoordinatorRttProbe {
  private timer: NodeJS.Timeout | null = null;
  private pending: bigint | null = null;
  measuredRttMs: number | null = null;

  constructor(private readonly options: {
    intervalMs: number;
    previousRttMs(): number | undefined;
    onSample(smoothedMs: number): void;
    warn(message: string): void;
  }) {}

  start(socket: WebSocket): void {
    this.stop();
    const timeoutMs = Math.max(45_000, this.options.intervalMs * 3);
    const probe = (): void => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const now = process.hrtime.bigint();
      if (this.pending !== null) {
        // Replacing this timestamp hides blackholes and mismeasures late pongs.
        if (Number(now - this.pending) / 1_000_000 >= timeoutMs) {
          this.options.warn("Coordinator pong timed out; reconnecting transport.");
          this.stop();
          // Reuse the worker's close/reconnect/offset-ACK recovery path. A
          // closing handshake cannot finish over a blackholed connection.
          socket.terminate();
        }
        return;
      }
      this.pending = now;
      try { socket.ping(PAYLOAD); }
      catch { this.pending = null; }
    };
    probe();
    this.timer = setInterval(probe, this.options.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.pending = null;
  }

  recordSample(payload: Buffer): void {
    const sentAt = this.pending;
    if (sentAt === null || !payload.equals(PAYLOAD)) return;
    this.pending = null;
    const sampleMs = Number(process.hrtime.bigint() - sentAt) / 1_000_000;
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    const previous = this.options.previousRttMs();
    const smoothed = previous === undefined || previous <= 0
      ? sampleMs : previous * (1 - EMA_ALPHA) + sampleMs * EMA_ALPHA;
    this.options.onSample(Math.round(smoothed * 100) / 100);
    this.measuredRttMs = sampleMs;
  }
}
