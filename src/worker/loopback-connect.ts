import { createConnection, type Socket } from "node:net";

/** Retry refused connections before sending any bytes, within one fixed deadline. */
export async function connectPreparedLoopback(
  port: number, timeoutMs: number, signal: AbortSignal, authorized: () => boolean,
): Promise<Socket> {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("runtime_stream_connect_options_invalid");
  const deadline = performance.now() + timeoutMs;
  const check = () => {
    if (signal.aborted) throw new Error("runtime_stream_connect_cancelled");
    if (!authorized()) throw new Error(`runtime_stream_target_is_not_authorized:${port}`);
    if (performance.now() >= deadline) throw new Error(`runtime_stream_connect_timeout:${port}`);
  };
  for (;;) {
    check();
    try {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const candidate = createConnection({ host: "127.0.0.1", port });
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          candidate.removeListener("connect", connected);
          candidate.removeListener("error", failed);
          candidate.removeListener("timeout", timedOut);
          signal.removeEventListener("abort", aborted);
          candidate.setTimeout(0);
          if (error) { candidate.destroy(); reject(error); }
          else { candidate.pause(); resolve(candidate); }
        };
        const connected = () => finish();
        const failed = (error: Error) => finish(error);
        const timedOut = () => finish(new Error(`runtime_stream_connect_timeout:${port}`));
        const aborted = () => finish(new Error("runtime_stream_connect_cancelled"));
        candidate.once("connect", connected);
        candidate.once("error", failed);
        candidate.once("timeout", timedOut);
        signal.addEventListener("abort", aborted, { once: true });
        candidate.setTimeout(Math.max(1, deadline - performance.now()));
        if (signal.aborted) aborted();
      });
      try { check(); return socket; } catch (error) { socket.destroy(); throw error; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw error;
      check();
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer); signal.removeEventListener("abort", aborted);
          reject(new Error("runtime_stream_connect_cancelled"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted); resolve();
        }, Math.min(50, Math.max(1, deadline - performance.now())));
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
    }
  }
}
