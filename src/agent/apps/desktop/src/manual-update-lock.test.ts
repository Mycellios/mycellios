import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { requireNoManualUpdate } from "./manual-update-lock";

it("allows a fresh profile and an unlocked leftover without removing recovery evidence", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "update-lock-"));
  try {
    await requireNoManualUpdate(profile);
    await mkdir(path.join(profile, "updates"));
    const file = path.join(profile, "updates", "active-install.lock");
    await writeFile(file, "previous worker");
    await requireNoManualUpdate(profile);
    expect(await readFile(file, "utf8")).toBe("previous worker");
  } finally { await rm(profile, { recursive: true, force: true }); }
});

it.runIf(process.platform === "win32")("refuses a handoff while the Windows worker holds its exclusive file lock", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "update-lock-"));
  await mkdir(path.join(profile, "updates"));
  const script = path.join(profile, "hold.ps1");
  const file = path.join(profile, "updates", "active-install.lock");
  await writeFile(script, `param([string]$File)
$lock=[IO.File]::Open($File,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {[Console]::WriteLine('locked');[Console]::Out.Flush();[Console]::ReadLine()|Out-Null} finally {$lock.Dispose()}
`);
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script, file], { windowsHide: true });
  const closed = once(child, "close");
  try {
    await Promise.race([once(child.stdout!, "data"), closed.then(() => { throw Error("Lock worker exited"); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(Error("Lock worker timeout")), 15_000); timer.unref(); })]);
    await expect(requireNoManualUpdate(profile)).rejects.toThrow("Another update is still running");
  } finally {
    child.stdin!.end("\n"); await closed;
    await rm(profile, { recursive: true, force: true });
  }
}, 25_000);
