import { HOST_COMPUTER_MAX_BYTES } from "./host-computer-protocol.js";
import { getLogger } from "@mycellios/logging";
import { ComputerUpdatingError } from "./computer-errors.js";
import { desktopFailureCode, desktopLegacyFailureCode, desktopDiagnosticMessage, desktopDiagnosticStage, desktopOperationId, parseDesktopDiagnostic, type DesktopFailureCode, type DesktopDiagnosticStage } from "@mycellios/contracts";

/** A complete native stream is required; EOF is never a successful run or callback. */
export async function* desktopAgentFrames(response: Response, signal: AbortSignal, phase: "callback" | "run" = "run"): AsyncIterable<unknown> {
  const operationId = desktopOperationId(response.headers.get("x-mycellios-desktop-operation"));
  const started = Date.now();
  const failure = (code: DesktopFailureCode, stage: DesktopDiagnosticStage, frameId?: unknown) => {
    const diagnostic = { code, phase, stage, operationId: operationId ?? desktopOperationId(frameId) };
    // A full queue before dispatch is an expected wait; sendWhenPcHasRoom logs it once.
    if (!(code === "desktop_busy" && stage === "dispatch")) getLogger().warn("desktop.relay.stream_interrupted", { "desktop.phase": phase, "desktop.reason": code,
      "desktop.stage": stage, "desktop.operation.id": diagnostic.operationId, "desktop.elapsed_ms": Date.now() - started });
    return Error(desktopDiagnosticMessage(diagnostic));
  };
  if (!response.ok || !response.body) {
    const code = response.headers.get("x-mycellios-desktop-error");
    await response.body?.cancel();
    if (code === "desktop_updating") throw new ComputerUpdatingError(false);
    throw failure(desktopFailureCode(code) ?? "relay_stream_failure", "dispatch");
  }
  getLogger().info("desktop.relay.stream_started", { "desktop.phase": phase, "desktop.operation.id": operationId });
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
      if (Buffer.byteLength(pending) > HOST_COMPUTER_MAX_BYTES) throw failure("invalid_frame", "native_stream");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (!line) continue;
        let frame: { value?: unknown; done?: boolean; heartbeat?: boolean; error?: string; code?: string; dispatched?: boolean; stage?: unknown; operationId?: unknown };
        try { frame = JSON.parse(line); if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw Error(); }
        catch { throw failure("invalid_frame", "native_stream"); }
        if (done) throw failure("invalid_frame", "native_stream");
        if (frame.error) {
          if (frame.code === "desktop_updating") throw new ComputerUpdatingError(frame.dispatched !== false);
          const reason = desktopFailureCode(frame.code) ?? (frame.code === "desktop_session_missing" ? "native_session_missing" : desktopLegacyFailureCode(frame.error));
          throw failure(reason, desktopDiagnosticStage(frame.stage) ?? "native_stream", frame.operationId);
        }
        if (frame.done === true) { done = true; continue; }
        if (frame.heartbeat === true) continue;
        if (!Object.hasOwn(frame, "value")) throw failure("invalid_frame", "native_stream");
        yield frame.value;
      }
    }
    if (!done || pending.trim()) throw failure("stream_incomplete", "native_stream");
    getLogger().info("desktop.relay.stream_completed", { "desktop.phase": phase, "desktop.operation.id": operationId, "desktop.elapsed_ms": Date.now() - started });
  } catch (error) {
    if (signal.aborted || error instanceof ComputerUpdatingError || (error instanceof Error && parseDesktopDiagnostic(error.message))) throw error;
    throw failure("native_transport_interrupted", "native_stream");
  } finally { signal.removeEventListener("abort", abort); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
