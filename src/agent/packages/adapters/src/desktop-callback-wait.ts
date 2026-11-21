import { setTimeout as delay } from "node:timers/promises";
import { getLogger } from "@rakazo/logging";
import { parseDesktopDiagnostic } from "@rakazo/contracts";

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
  for (let pause = 250; ; pause = Math.min(pause * 2, 2_000)) {
    try { await send(); return; }
    catch (error) {
      if (!busyBeforeDispatch(error) || signal.aborted || Date.now() - started + pause > waitMs) throw error;
      getLogger().info("desktop.agent.callback_waiting", { "run.id": runId, "desktop.elapsed_ms": Date.now() - started });
      await delay(pause, undefined, { signal });
    }
  }
}
