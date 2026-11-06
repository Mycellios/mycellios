import { HOST_COMPUTER_MAX_BYTES } from "./host-computer-protocol.js";
import { ComputerUpdatingError } from "./computer-errors.js";

/** A complete native stream is required; EOF is never a successful run or callback. */
export async function* desktopAgentFrames(response: Response, signal: AbortSignal): AsyncIterable<unknown> {
  if (!response.ok || !response.body) { await response.body?.cancel(); if (response.headers.get("x-mycellios-desktop-error") === "desktop_updating") throw new ComputerUpdatingError(false); throw Error("Desktop executor unavailable; check the PC connection before retrying"); }
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
        if (frame.error) { if (frame.code === "desktop_updating") throw new ComputerUpdatingError(frame.dispatched !== false); throw Error("Desktop execution interrupted; check existing results before retrying"); }
        if (frame.done === true) { done = true; continue; }
        if (frame.heartbeat === true) continue;
        if (!Object.hasOwn(frame, "value")) throw Error("Invalid Desktop runtime frame");
        yield frame.value;
      }
    }
    if (!done || pending.trim()) throw Error("Desktop execution disconnected; check existing results before retrying");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
