import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "./setup-store.js";
import type { ManualRelease } from "./manual-update.js";
import { manualUpdatePhase } from "./manual-update-handoff.js";

const BUNDLE_ID = "com.mycellios.agent.desktop";

/**
 * The .app this process runs from, when the owner can replace it in place.
 * A translocated or read-only app (for example a standard user in /Applications)
 * keeps the disk-image installer instead.
 */
export function macosSelfUpdateBundle(executable: string, canWrite = (file: string) => {
  try { accessSync(file, constants.W_OK); return true; } catch { return false; }
}): string | null {
  const macos = path.posix.dirname(executable);
  const contents = path.posix.dirname(macos);
  const bundle = path.posix.dirname(contents);
  if (path.posix.basename(macos) !== "MacOS" || path.posix.basename(contents) !== "Contents" ||
      !bundle.endsWith(".app") || !path.posix.isAbsolute(bundle) || bundle.includes("/AppTranslocation/")) return null;
  return canWrite(path.posix.dirname(bundle)) && canWrite(bundle) ? bundle : null;
}

/** Start the helper and return once it is waiting for this process to quit. */
export async function launchMacosUpdate(options: {
  profile: string; bundle: string; dmg: string; release: ManualRelease; oldPid: number;
}): Promise<void> {
  const job = path.join(options.profile, "updates", randomUUID());
  await mkdir(job, { recursive: true, mode: 0o700 });
  const helper = path.join(job, "manual-update-macos.sh");
  await writePrivateFile(helper, await readFile(new URL("./manual-update-macos.sh", import.meta.url), "utf8"));
  const log = await open(path.join(job, "helper.log"), "wx", 0o600);
  const child = (() => {
    try {
      return spawn("/bin/bash", [helper, job, String(options.oldPid), options.dmg, options.bundle,
        options.release.version, BUNDLE_ID], { detached: true, stdio: ["ignore", log.fd, log.fd], cwd: job });
    } finally { void log.close().catch(() => undefined); }
  })();
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const phase = await readFile(path.join(job, "progress.json"), "utf8").then(manualUpdatePhase).catch(() => null);
    if (phase === "waiting-for-app") return;
    if (child.exitCode !== null) throw Error(`The update helper exited before handoff (${child.exitCode})`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill();
  throw Error("The update helper did not acknowledge the handoff");
}
