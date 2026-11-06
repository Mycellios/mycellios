import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it.runIf(process.platform === "win32")("parses the real helper and requires the app to exit normally", async () => {
  const source = path.join(import.meta.dirname, "manual-update-helper.ps1");
  const text = await readFile(source, "utf8");
  expect(text).not.toMatch(/Stop-Process|taskkill|ExecutionPolicy|RmShutdown|legacyShutdown/);
  expect(text).toContain("The previous app has not finished saving; update was not applied");
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-helper-"));
  try {
    const file = path.join(directory, "parse.ps1");
    await writeFile(file, `$ErrorActionPreference='Stop'\n$tokens=$null;$issues=$null\n[Management.Automation.Language.Parser]::ParseFile('${source.replaceAll("'", "''")}',[ref]$tokens,[ref]$issues)|Out-Null\nif($issues.Count){throw ($issues.Message -join '; ')}\nWrite-Output 'helper parsed'`);
    const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", file], { windowsHide: true, timeout: 30_000 });
    expect(result.stdout).toContain("helper parsed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
