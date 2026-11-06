import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writePrivateFile } from "./setup-store.js";
import type { ManualRelease } from "./manual-update.js";

export async function launchManualUpdate(options: {
  profile: string; executable: string; oldPid: number; installer: string;
  release: ManualRelease; reopenUrl: string;
}): Promise<void> {
  const directory = path.join(options.profile, "updates", randomUUID());
  const helper = path.join(directory, "manual-update-helper.ps1");
  const config = path.join(directory, "request.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateFile(helper, await readFile(new URL("./manual-update-helper.ps1", import.meta.url), "utf8"));
  await writePrivateFile(config, JSON.stringify({ schema: "mycellios-manual-update/1",
    profile: options.profile, executable: options.executable, oldPid: options.oldPid,
    installer: options.installer, version: options.release.version, sha256: options.release.sha256,
    bytes: options.release.bytes, reopenUrl: options.reopenUrl }));
  const executable = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawn(executable, ["-NoProfile", "-NonInteractive", "-File", helper, "-ConfigFile", config], {
    detached: true, windowsHide: true, stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  // A successful spawn is not a successful handoff: wait for the exact worker's acknowledgement.
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const state = JSON.parse(await readFile(path.join(directory, "progress.json"), "utf8"));
      if (state.phase === "waiting-for-app") {
        await writePrivateFile(path.join(directory, "commit.json"), JSON.stringify({ approved: true }));
        return;
      }
    } catch { /* The helper has not opened its receipt yet. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error("The update helper did not acknowledge the handoff");
}
