import { HOST_COMPUTER_MAX_BYTES } from "./host-computer-protocol.js";
import { getLogger } from "@rakazo/logging";
import { ComputerUpdatingError } from "./computer-errors.js";

/** A complete native stream is required; EOF is never a successful run or callback. */
export async function* desktopAgentFrames(response: Response, signal: AbortSignal, phase: "callback" | "run" = "run"): AsyncIterable<unknown> {
  if (!response.ok || !response.body) {
    const code = response.headers.get("x-mycellios-desktop-error");
    await response.body?.cancel();
    if (code === "desktop_updating") throw new ComputerUpdatingError(false);
    getLogger().warn("desktop.relay.request_unavailable", { "desktop.phase": phase, "http.status": response.status,
      "desktop.reason": ["desktop_busy", "desktop_disconnected", "desktop_connection_changed", "desktop_request_too_large"].includes(code ?? "") ? code : "unavailable_response" });
    throw Error("Desktop executor unavailable; check the PC connection before retrying");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", done = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) break;
      pending += decoder.decode(chunk.value, { stream: true });
      if (Buffer.byteLength(pending) > HOST_COMPUTER_MAX_BYTES) throw Error("Desktop runtime frame too large");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line) continue;
        const frame = JSON.parse(line) as { value?: unknown; done?: boolean; heartbeat?: boolean; error?: string; code?: string; dispatched?: boolean };
        if (done) throw Error("Data after Desktop runtime completion");
        if (frame.error) {
          if (frame.code === "desktop_updating") throw new ComputerUpdatingError(frame.dispatched !== false);
          const reason = frame.error === "Desktop delivery was interrupted. Check results before retrying." ? "delivery_lost"
            : frame.error === "Desktop operation interrupted. Check results before retrying." ? "native_transport_interrupted"
            : frame.code === "desktop_session_missing" ? "native_session_missing"
            : frame.error === "Local computer operation failed" ? "native_host_failure" : "relay_stream_failure";
          getLogger().warn("desktop.relay.stream_interrupted", { "desktop.phase": phase, "desktop.reason": reason });
          throw Error("Desktop execution interrupted; check existing results before retrying");
        }
        if (frame.done === true) { done = true; continue; }
        if (frame.heartbeat === true) continue;
        if (!Object.hasOwn(frame, "value")) throw Error("Invalid Desktop runtime frame");
        yield frame.value;
      }
    }
    if (!done || pending.trim()) throw Error("Desktop execution disconnected; check existing results before retrying");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
