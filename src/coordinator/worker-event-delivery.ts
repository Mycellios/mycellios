import type { FastifyBaseLogger } from "fastify";
import type { WorkerEnvelope } from "../contracts/types.js";
import type { AsyncTaskScope } from "../core/async-task-scope.js";
import type { ConnectionState, WorkerDisconnectDetails } from "./worker-connection-state.js";

export type WorkerDisconnectObserver = (workerId: string, details?: WorkerDisconnectDetails) => void | Promise<void>;

export interface WorkerEventConsumer {
  envelope(envelope: WorkerEnvelope): Promise<void>;
  disconnect(workerId: string): Promise<void>;
}

export class WorkerEventDelivery {
  private readonly consumers = new Set<WorkerEventConsumer>();
  private readonly observers = new Set<WorkerDisconnectObserver>();
  constructor(private readonly emitter: { emit(type: "disconnect", workerId: string, details?: WorkerDisconnectDetails): boolean },
    private readonly logger: () => FastifyBaseLogger | null | undefined) {}
  beforeDisconnect(observer: WorkerDisconnectObserver): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }
  subscribe(consumer: WorkerEventConsumer): () => void {
    this.consumers.add(consumer);
    return () => { this.consumers.delete(consumer); };
  }
  async envelope(envelope: WorkerEnvelope): Promise<void> {
    for (const consumer of this.consumers) await consumer.envelope(envelope);
  }
  async disconnect(workerId: string, details?: WorkerDisconnectDetails): Promise<void> {
    for (const observer of this.observers) {
      try { await observer(workerId, details); }
      catch (error) { this.logger()?.warn({ error, workerId }, "worker disconnect capture failed; normal repair remains active"); }
    }
    for (const consumer of this.consumers) await consumer.disconnect(workerId);
    this.emitter.emit("disconnect", workerId, details);
  }
}

/** Bound retained frames while waiting for authorization, SQL and consumers. */
export class WorkerInboundQueue {
  private bytes = 0;
  private readonly byConnection = new WeakMap<ConnectionState, number>();
  private stopped = false;
  constructor(private readonly tasks: AsyncTaskScope,
    private readonly deliver: (state: ConnectionState, raw: string) => Promise<void>) {}

  stop(): void { this.stopped = true; }

  enqueue(state: ConnectionState, raw: string): void {
    if (this.stopped || state.closed || state.socket.readyState !== state.socket.OPEN) return;
    const bytes = Buffer.byteLength(raw, "utf8");
    const queued = this.byConnection.get(state) ?? 0;
    if (bytes > 2_200_000 || queued + bytes > 32 * 1024 * 1024 || this.bytes + bytes > 64 * 1024 * 1024) {
      state.recoveryDenied = true;
      state.socket.close(4429, "worker input backpressure exceeded");
      return;
    }
    this.bytes += bytes;
    this.byConnection.set(state, queued + bytes);
    this.tasks.run("worker-frame", async () => {
      try { await this.deliver(state, raw); }
      finally {
        this.bytes -= bytes;
        this.byConnection.set(state, (this.byConnection.get(state) ?? bytes) - bytes);
      }
    }, state);
  }
}
