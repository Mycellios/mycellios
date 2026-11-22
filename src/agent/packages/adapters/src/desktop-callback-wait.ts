import { setTimeout as delay } from "node:timers/promises";
import { getLogger } from "@mycellios/logging";
import { parseDesktopDiagnostic } from "@mycellios/contracts";

/** How long a callback waits for a free slot when the PC's queue is full. */
const BUSY_DISPATCH_WAIT_MS = 120_000;

/** The relay refused before dispatch: nothing reached the PC, so sending again cannot replay it. */
export function busyBeforeDispatch(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ((error as { code?: unknown }).code === "desktop_busy") return true;
  const diagnostic = parseDesktopDiagnostic(error.message);
  return diagnostic?.code === "desktop_busy" && diagnostic.stage === "dispatch";
}

/** Parallel tool calls and a concurrent routine can fill the PC's callback lane; wait for a slot. */
export async function sendWhenPcHasRoom(send: () => Promise<void>, runId: string, signal: AbortSignal, waitMs = BUSY_DISPATCH_WAIT_MS): Promise<void> {
  const started = Date.now();
  let waited = false;
  for (let pause = 250; ; pause = Math.min(pause * 2, 2_000)) {
    try {
      await send();
      if (waited) getLogger().info("desktop.agent.callback_sent_after_wait", { "run.id": runId, "desktop.elapsed_ms": Date.now() - started });
      return;
    } catch (error) {
      const busy = busyBeforeDispatch(error);
      if (!busy || signal.aborted || Date.now() - started + pause > waitMs) {
        if (busy) getLogger().warn("desktop.agent.callback_wait_exhausted", { "run.id": runId, "desktop.elapsed_ms": Date.now() - started });
        throw error;
      }
      // One line per wait, not per attempt: a busy PC can take minutes to free a slot.
      if (!waited) getLogger().info("desktop.agent.callback_waiting", { "run.id": runId });
      waited = true;
      await delay(pause, undefined, { signal });
    }
  }
}
