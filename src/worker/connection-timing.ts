import WebSocket from "ws";

/**
 * Upper bound from opening a coordinator socket until `server.ready`.
 * Without it, an upgrade that a proxy accepts but never answers (or a hello
 * that is never acknowledged) leaves the worker waiting forever: no ping
 * liveness runs before open and the reconnect loop never regains control.
 */
export const COORDINATOR_READY_TIMEOUT_MS = 60_000;

/** Terminates a coordinator socket that is not acknowledged in time, so reconnect resumes. */
export class CoordinatorReadyDeadline {
  private timer: NodeJS.Timeout | null = null;
  private socket: WebSocket | null = null;

  constructor(
    private readonly acknowledged: () => boolean,
    private readonly warn: (message: string) => void,
    private readonly timeoutMs = COORDINATOR_READY_TIMEOUT_MS,
  ) {}

  arm(socket: WebSocket): void {
    this.clear();
    this.socket = socket;
    const timer = setTimeout(() => {
      if (this.timer !== timer) return;
      this.timer = null;
      this.socket = null;
      if (this.acknowledged() || socket.readyState === WebSocket.CLOSED) return;
      this.warn(`Coordinator did not acknowledge this worker within ${this.timeoutMs}ms; reconnecting`);
      socket.terminate();
    }, this.timeoutMs);
    timer.unref?.();
    this.timer = timer;
  }

  /** Clears the deadline; with a socket, only if it is the one being watched. */
  clear(socket?: WebSocket): void {
    if (!this.timer || (socket && this.socket !== socket)) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.socket = null;
  }
}

export async function readResponseTextLimited(response: Response, limitBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let result = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limitBytes) {
        throw new Error(`Response body exceeds ${limitBytes} bytes`);
      }
      result += decoder.decode(value, { stream: true });
    }
    result += decoder.decode();
    return result;
  } finally {
    reader.releaseLock();
  }
}

export function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? "worker_start_cancelled"));
}
