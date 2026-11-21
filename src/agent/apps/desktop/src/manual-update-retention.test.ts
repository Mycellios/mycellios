import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ManualUpdateInProgressError } from "./manual-update-lock.js";
import { pruneManualUpdates } from "./manual-update-retention.js";

let profile: string, updates: string;
beforeEach(async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), "mycellios update retention "));
  updates = path.join(profile, "updates");
  await mkdir(path.join(updates, "manual"), { recursive: true });
});
afterEach(async () => { await rm(profile, { recursive: true, force: true }); });

const id = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
async function job(n: number, minutesAgo: number) {
  const directory = path.join(updates, id(n));
  await mkdir(path.join(directory, "backup"), { recursive: true });
  await writeFile(path.join(directory, "backup", "copy.bin"), "backup");
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await utimes(directory, at, at);
}
const installer = (version: string, suffix = "") =>
  writeFile(path.join(updates, "manual", `Mycellios-Desktop-${version}-windows-x64-pilot.exe${suffix}`), "x");

it("keeps the newest update jobs and installers for the running or a newer version", async () => {
  for (let n = 1; n <= 6; n++) await job(n, 60 - n);
  await mkdir(path.join(updates, "not-a-job"));
  for (const version of ["0.3.15", "0.6.0", "0.7.0", "0.8.0"]) await installer(version);
  await installer("0.5.1", ".part");
  await writeFile(path.join(updates, "manual", "notes.txt"), "kept");

  expect(await pruneManualUpdates(profile, "0.7.0")).toEqual({ jobs: 3, installers: 3 });

  expect((await readdir(updates)).sort()).toEqual([id(4), id(5), id(6), "manual", "not-a-job"].sort());
  expect((await readdir(path.join(updates, "manual"))).sort()).toEqual([
    "Mycellios-Desktop-0.7.0-windows-x64-pilot.exe",
    "Mycellios-Desktop-0.8.0-windows-x64-pilot.exe",
    "notes.txt",
  ]);
});

// The helper's lock is an exclusive Windows share mode, the same one this test holds.
it.runIf(process.platform === "win32")("removes nothing while an update helper holds the install lock", async () => {
  for (let n = 1; n <= 5; n++) await job(n, n);
  await installer("0.1.0");
  const lock = path.join(updates, "active-install.lock");
  const holder = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    `$f=[IO.File]::Open('${lock.replaceAll("'", "''")}','OpenOrCreate','ReadWrite','None');Write-Output held;Start-Sleep 20`], { windowsHide: true });
  await new Promise<void>(resolve => holder.stdout!.once("data", () => resolve()));
  try {
    await expect(pruneManualUpdates(profile, "0.7.0")).rejects.toBeInstanceOf(ManualUpdateInProgressError);
  } finally { holder.kill(); await new Promise(resolve => holder.once("exit", resolve)); }
  expect((await readdir(updates)).filter(name => name.endsWith("000000000000"))).toHaveLength(5);
  expect(await readdir(path.join(updates, "manual"))).toHaveLength(1);
}, 30_000);

it("does nothing when the profile has no updates", async () => {
  await rm(updates, { recursive: true });
  expect(await pruneManualUpdates(profile, "0.7.0")).toEqual({ jobs: 0, installers: 0 });
});
