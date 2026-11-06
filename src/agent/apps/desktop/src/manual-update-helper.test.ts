import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { manualUpdatePhase } from "./manual-update-handoff.js";

it("reads UTF-8 progress receipts with and without a BOM", () => {
  expect(manualUpdatePhase('\uFEFF{ "phase": "waiting-for-app" }')).toBe("waiting-for-app");
  expect(manualUpdatePhase('{ "phase": "waiting-for-app" }')).toBe("waiting-for-app");
  expect(manualUpdatePhase('{ "phase": "installing" }')).toBe("installing");
});

it("does not acknowledge malformed or unrelated receipts", () => {
  for (const value of ["null", "[]", "{}", '{"phase":true}']) expect(manualUpdatePhase(value)).toBeNull();
  expect(() => manualUpdatePhase("\uFEFF{partial")).toThrow();
});

it.runIf(process.platform === "win32")("reads the actual Windows PowerShell receipt encoding", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-receipt-"));
  try {
    const receipt = path.join(directory, "progress.json");
    const script = path.join(directory, "write.ps1");
    await writeFile(script, "$ErrorActionPreference='Stop'\n@{phase='waiting-for-app'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $PSScriptRoot 'progress.json') -Encoding UTF8");
    await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", script], { windowsHide: true, timeout: 30_000 });
    const bytes = await readFile(receipt);
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(() => JSON.parse(bytes.toString("utf8"))).toThrow();
    expect(manualUpdatePhase(bytes.toString("utf8"))).toBe("waiting-for-app");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
