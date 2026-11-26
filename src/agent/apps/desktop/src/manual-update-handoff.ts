import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, open, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writePrivateFile } from "./setup-store.js";
import type { ManualRelease } from "./manual-update.js";
import { requireNoManualUpdate } from "./manual-update-lock.js";

const UPDATE_JOB = /^--manual-update-job=([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/;

/** Acknowledge the running package, after acquiring the profile's instance lock. */
export async function acknowledgeManualUpdate(
  profile: string, executable: string, version: string, pid: number, args: readonly string[],
): Promise<void> {
  const job = args.map(arg => UPDATE_JOB.exec(arg)?.[1]).find(Boolean);
  if (!job) return;
  const directory = path.join(profile, "updates", job);
  const request = JSON.parse((await readFile(path.join(directory, "request.json"), "utf8")).replace(/^\uFEFF/, ""));
  const commit = JSON.parse(await readFile(path.join(directory, "commit.json"), "utf8"));
  if (request?.schema !== "mycellios-manual-update/1" || request.version !== version ||
      typeof request.executable !== "string" || request.executable.toLowerCase() !== executable.toLowerCase() ||
      commit?.approved !== true) return;
  await writePrivateFile(path.join(directory, "launch.json"), JSON.stringify({ version, pid }));
}

/** Windows PowerShell 5.1 writes UTF-8 receipts with a byte-order mark. */
export function manualUpdatePhase(contents: string): string | null {
  const state: unknown = JSON.parse(contents.replace(/^\uFEFF/, ""));
  return state !== null && typeof state === "object" && "phase" in state && typeof state.phase === "string"
    ? state.phase : null;
}

export async function launchManualUpdate(options: {
  profile: string; executable: string; oldPid: number; installer: string;
  release: ManualRelease; reopenUrl: string;
  ownerWindow?: string;
  prepareToQuit?(): Promise<void>;
  /** Test seam: the launcher command. Defaults to Windows PowerShell 5.1. */
  launcher?: { executable: string; args(helper: string, config: string): string[] };
  retryDelaysMs?: readonly number[];
}): Promise<void> {
  // Windows process APIs report long paths, while TEMP/profile inputs can use
  // 8.3 aliases. Resolve the same files before the worker checks process identity.
  const profile = await realpath(options.profile);
  const appExecutable = await realpath(options.executable);
  const installer = await realpath(options.installer);
  const delays = options.retryDelaysMs ?? LAUNCHER_INIT_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      return await launchManualUpdateOnce(options, profile, appExecutable, installer);
    } catch (error) {
      // Windows can briefly refuse to initialize a new PowerShell process
      // (STATUS_DLL_INIT_FAILED, e.g. while many console processes exhaust the
      // desktop heap). That launcher ran no script line: nothing was verified,
      // locked or installed, so a fresh attempt in a new job folder is safe.
      if (!(error instanceof LauncherInitFailure) || attempt >= delays.length) throw error;
      await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    }
  }
}

/** Windows STATUS_DLL_INIT_FAILED (0xC0000142), as Node reports the exit code. */
export const STATUS_DLL_INIT_FAILED = 0xC0000142;
const LAUNCHER_INIT_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];

class LauncherInitFailure extends Error {}

async function launchManualUpdateOnce(options: Parameters<typeof launchManualUpdate>[0],
  profile: string, appExecutable: string, installer: string): Promise<void> {
  await requireNoManualUpdate(profile);
  const directory = path.join(profile, "updates", randomUUID());
  const helper = path.join(directory, "manual-update-helper.ps1");
  const config = path.join(directory, "request.json");
  const commit = path.join(directory, "commit.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writePrivateFile(helper, await readFile(new URL("./manual-update-helper.ps1", import.meta.url), "utf8"));
  await writePrivateFile(config, JSON.stringify({ schema: "mycellios-manual-update/1",
    profile, executable: appExecutable, oldPid: options.oldPid, ownerWindow: options.ownerWindow,
    installer, version: options.release.version, sha256: options.release.sha256,
    bytes: options.release.bytes, reopenUrl: options.reopenUrl }));
  const executable = options.launcher?.executable ??
    path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const args = options.launcher?.args(helper, config) ??
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", helper, "-ConfigFile", config, "-Launch"];
  // Detached PowerShell 5.1 can exit before running the script. A hidden
  // launcher starts the actual helper outside Electron's direct-child job.
  const output = await open(path.join(directory, "launcher.log"), "wx", 0o600);
  const child = (() => {
    try {
      return spawn(executable, args, {
        windowsHide: true, cwd: tmpdir(), stdio: ["ignore", output.fd, output.fd],
      });
    } finally {
      void output.close().catch(() => undefined);
    }
  })();
  // A successful spawn is not a successful handoff: wait for the exact worker's acknowledgement.
  // Windows scans and any owner file confirmation happen while Desktop stays open.
  const started = Date.now();
  let lastPhase: string | null = null;
  try {
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
    child.unref();
    while (true) {
      const phase = await readFile(path.join(directory, "progress.json"), "utf8")
        .then(manualUpdatePhase).catch(() => null);
      if (phase) lastPhase = phase;
      if (child.exitCode !== null || child.signalCode !== null) {
        const failure = await readFile(path.join(directory, "result.json"), "utf8")
          .then(contents => JSON.parse(contents.replace(/^\uFEFF/, "")) as { error?: unknown })
          .catch(() => null);
        const detail = typeof failure?.error === "string" ? `: ${failure.error.slice(0, 500)}` : "";
        // No progress, result or worker log: the launcher died before its first line.
        if (child.exitCode === STATUS_DLL_INIT_FAILED && lastPhase === null && failure === null &&
            !await access(path.join(directory, "helper.log")).then(() => true, () => false)) {
          throw new LauncherInitFailure("The update helper could not start: Windows did not initialize PowerShell");
        }
        throw Error(`The update helper exited before handoff (${child.exitCode ?? child.signalCode})${detail}`);
      }
      if (phase === "waiting-for-app") {
        await options.prepareToQuit?.();
        await writePrivateFile(commit, JSON.stringify({ approved: true }));
        return;
      }
      const checkingWithWindows = lastPhase === "waiting-for-windows-approval" || lastPhase === "scanning-installer";
      if (Date.now() >= started + (checkingWithWindows ? 8 * 60_000 : 120_000)) {
        throw Error(checkingWithWindows ? "The Windows installer check did not finish" : "The update helper did not acknowledge the handoff");
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch (error) {
    // The launcher owns the worker's process handle. Cancel only this uncommitted
    // attempt so a suspended Windows scan cannot hold the profile lock forever.
    if (child.exitCode === null && child.signalCode === null) {
      await writePrivateFile(path.join(directory, "cancel.json"), "{}").catch(() => undefined);
    }
    // An early launcher failure can leave both PowerShell logs empty. Record
    // bounded process facts locally so it can be diagnosed without user content,
    // credentials, an installer retry or a forced application shutdown.
    const code = (error as NodeJS.ErrnoException | null)?.code;
    await writePrivateFile(path.join(directory, "handoff-error.json"), JSON.stringify({
      schema: "mycellios-update-handoff-error/1", at: new Date().toISOString(),
      phase: lastPhase, exitCode: child.exitCode, signal: child.signalCode,
      spawnErrorCode: typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code) ? code : null,
    })).catch(() => undefined);
    throw error;
  }
}
