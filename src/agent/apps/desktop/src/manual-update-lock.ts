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
