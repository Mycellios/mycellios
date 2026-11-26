import { lstat, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { requireNoManualUpdate } from "./manual-update-lock.js";
import { newerRelease } from "./manual-update.js";

const JOB = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const INSTALLER = /^Mycellios-Desktop-(\d{1,6}\.\d{1,6}\.\d{1,6})-windows-x64-pilot\.exe(?:\.part)?$/;
/** The newest jobs keep their receipts. */
export const RETAINED_UPDATE_JOBS = 3;

/**
 * Electron's patched fs treats `*.asar` files as directories. Older jobs kept a
 * backup of the installation (with app.asar), and a recursive rm through the
 * patched fs never finished there, so nothing after it was ever removed.
 * The unpatched module sees them as the plain files they are.
 */
const removeTree: typeof rm = process.versions.electron
  ? (createRequire(import.meta.url)("original-fs") as typeof import("node:fs")).promises.rm
  : rm;

/**
 * Each Windows update leaves a job folder (older versions also left a profile backup there)
 * and its installer behind.
 * Remove the older ones so the profile does not grow with every release. Nothing is removed
 * while a helper holds the install lock, and installers for the running or a newer version stay.
 * One entry that cannot be removed never keeps the others.
 */
export async function pruneManualUpdates(profile: string, currentVersion: string): Promise<{ jobs: number; installers: number }> {
  await requireNoManualUpdate(profile);
  const updates = path.join(profile, "updates");
  const removed = { jobs: 0, installers: 0 };
  // Installers first: they hold most of the space.
  const manual = path.join(updates, "manual");
  for (const entry of await readdir(manual, { withFileTypes: true }).catch(() => [])) {
    const version = INSTALLER.exec(entry.name)?.[1];
    if (!entry.isFile() || !version || !newerRelease(currentVersion, version)) continue;
    if (await removeTree(path.join(manual, entry.name), { force: true }).then(() => true, () => false)) removed.installers++;
  }
  const entries = await readdir(updates, { withFileTypes: true }).catch(() => []);
  const jobs = await Promise.all(entries.filter(entry => entry.isDirectory() && JOB.test(entry.name))
    .map(async entry => ({ name: entry.name, at: (await lstat(path.join(updates, entry.name))).mtimeMs })));
  jobs.sort((a, b) => b.at - a.at);
  for (const job of jobs.slice(RETAINED_UPDATE_JOBS)) {
    if (await removeTree(path.join(updates, job.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      .then(() => true, () => false)) removed.jobs++;
  }
  return removed;
}
