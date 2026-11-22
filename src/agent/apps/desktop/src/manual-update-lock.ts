import { open } from "node:fs/promises";
import path from "node:path";

export class ManualUpdateInProgressError extends Error {
  constructor() { super("Another update is still running. Keep using Mycellios and finish that installation before retrying."); }
}

/** The same-user PowerShell worker holds this file exclusively until it exits. */
export async function requireNoManualUpdate(profile: string): Promise<void> {
  try {
    const handle = await open(path.join(profile, "updates", "active-install.lock"), "r+");
    await handle.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ManualUpdateInProgressError();
  }
}

/**
 * A normal launch while the worker backs up or replaces this installation would
 * reopen the profile it is copying and abort the update. Only the worker's own
 * confirmed reopen (`--manual-update-job=`) may start before the lock is released.
 */
export async function manualUpdateBlocksStartup(profile: string, argv: readonly string[]): Promise<boolean> {
  if (argv.some(arg => arg.startsWith("--manual-update-job="))) return false;
  try { await requireNoManualUpdate(profile); return false; }
  catch (error) { return error instanceof ManualUpdateInProgressError; }
}
