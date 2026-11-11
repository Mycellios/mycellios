import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { acknowledgeManualUpdate, launchManualUpdate, manualUpdatePhase } from "./manual-update-handoff.js";

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
  expect(text).toMatch(/\$setup=Start-Process[^\r\n]+-WindowStyle Normal[^\r\n]+-PassThru\r?\n +Progress 'installing'\r?\n +if\(!\$setup\.WaitForExit\(600000\)\)/);
  const directory = await mkdtemp(path.join(os.tmpdir(), "manual-update-helper-"));
  try {
    const file = path.join(directory, "parse.ps1");
    await writeFile(file, `$ErrorActionPreference='Stop'\n$tokens=$null;$issues=$null\n[Management.Automation.Language.Parser]::ParseFile('${source.replaceAll("'", "''")}',[ref]$tokens,[ref]$issues)|Out-Null\nif($issues.Count){throw ($issues.Message -join '; ')}\nWrite-Output 'helper parsed'`);
    const result = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", file], { windowsHide: true, timeout: 30_000 });
    expect(result.stdout).toContain("helper parsed");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it.runIf(process.platform === "win32")("starts the hidden helper and keeps a rejected handoff uncommitted", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "mycellios update "));
  try {
    const updates = path.join(profile, "updates");
    await mkdir(updates);
    const fileName = "Mycellios-Desktop-0.0.1-windows-x64-pilot.exe";
    const installer = path.join(updates, fileName);
    await writeFile(installer, "fixture, never executable");
    const failure = await launchManualUpdate({
      profile,
      executable: path.join(profile, "Mycellios Desktop.exe"),
      oldPid: process.pid,
      installer,
      release: { version: "0.0.1", fileName, bytes: 1, sha256: "a".repeat(64), url: "https://example.test/fixture" },
      reopenUrl: "https://example.test",
    }).catch((error: unknown) => error);
    const [job] = (await readdir(updates, { withFileTypes: true })).filter(entry => entry.isDirectory());
    expect(job).toBeDefined();
    const files = await readdir(path.join(updates, job!.name));
    expect(files).toContain("helper.log");
    expect(files).not.toContain("commit.json");
    const log = await readFile(path.join(updates, job!.name, "helper.log"), "utf8");
    expect(files, log).toContain("result.json");
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("The update helper exited before handoff");
    const result = await readFile(path.join(updates, job!.name, "result.json"), "utf8");
    expect(JSON.parse(result.replace(/^\uFEFF/, ""))).toMatchObject({ installed: false, phase: "preflight" });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}, 60_000);

it.runIf(process.platform === "win32")("acknowledges a live app and survives its normal exit", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "mycellios update exit "));
  try {
    const updates = path.join(profile, "updates");
    const executable = path.join(profile, "Mycellios Desktop.exe");
    await mkdir(updates);
    await copyFile(process.execPath, executable);
    const fileName = "Mycellios-Desktop-0.0.1-windows-x64-pilot.exe";
    const installer = path.join(updates, fileName);
    const bytes = Buffer.from("fixture, never executable");
    await writeFile(installer, bytes);
    const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "manual-update-handoff.ts")).href;
    const request = {
      profile, executable, installer,
      release: {
        version: "0.0.1", fileName, bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        url: "https://example.test/fixture",
      },
      reopenUrl: "https://example.test",
    };
    const source = `
      import { readdir, readFile, writeFile } from "node:fs/promises";
      import path from "node:path";
      const { launchManualUpdate } = await import(process.argv[1]);
      const request = JSON.parse(process.argv[2]);
      await launchManualUpdate({ ...request, oldPid: process.pid });
      const updates = path.join(request.profile, "updates");
      const [job] = (await readdir(updates, { withFileTypes: true })).filter(entry => entry.isDirectory());
      const commit = path.join(updates, job.name, "commit.json");
      if (JSON.parse(await readFile(commit, "utf8")).approved !== true) throw Error("Missing acknowledgement");
      // Exit normally but prevent the dummy installer from running.
      await writeFile(commit, '{"approved":false}');
    `;
    await promisify(execFile)(executable, [
      "--import", "tsx", "--input-type=module", "-e", source, moduleUrl, JSON.stringify(request),
    ], { windowsHide: true, timeout: 50_000 });
    const [job] = (await readdir(updates, { withFileTypes: true })).filter(entry => entry.isDirectory());
    const result = path.join(updates, job!.name, "result.json");
    await expect.poll(async () => {
      const contents = await readFile(result, "utf8").catch(() => "");
      return contents ? JSON.parse(contents.replace(/^\uFEFF/, "")) : undefined;
    }, { timeout: 10_000, interval: 100 }).toMatchObject({
      installed: false,
      phase: "waiting-for-app",
      error: "The native install request was not committed",
    });
  } finally {
    // The worker writes its receipt immediately before closing the Windows log handles.
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 65_000);

it("only acknowledges the committed version and executable", async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), "mycellios update receipt "));
  const id = "b37dc114-849c-4e24-b002-17af4ad583c8";
  const job = path.join(profile, "updates", id);
  const args = [`--manual-update-job=${id}`];
  const executable = path.join(profile, "Mycellios Desktop.exe");
  const launch = path.join(job, "launch.json");
  try {
    await mkdir(job, { recursive: true });
    await writeFile(path.join(job, "request.json"), JSON.stringify({
      schema: "mycellios-manual-update/1", executable, version: "0.3.25",
    }));
    const commit = path.join(job, "commit.json");
    await writeFile(commit, '{"approved":false}');
    await acknowledgeManualUpdate(profile, executable, "0.3.25", 42, args);
    await writeFile(commit, '{"approved":true}');
    await acknowledgeManualUpdate(profile, executable, "0.3.24", 42, args);
    await acknowledgeManualUpdate(profile, process.execPath, "0.3.25", 42, args);
    await expect(readFile(launch, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await acknowledgeManualUpdate(profile, executable, "0.3.25", 42, args);
    expect(JSON.parse(await readFile(launch, "utf8"))).toEqual({ version: "0.3.25", pid: 42 });
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "win32")("verifies installation and confirms the restarted process on Windows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mycellios update install "));
  try {
    const profile = path.join(root, "profile");
    const installation = path.join(root, "installation");
    const executable = path.join(installation, "Mycellios Desktop.exe");
    const job = path.join(profile, "updates", "d2bccda6-de54-4468-9de8-17a6d2d16683");
    const installer = path.join(profile, "updates", "Mycellios-Desktop-0.0.1-windows-x64-pilot.exe");
    const draft = path.join(profile, "Local Storage", "draft.txt");
    await mkdir(job, { recursive: true });
    await mkdir(installation);
    await mkdir(path.dirname(draft));
    await writeFile(draft, "draft from before the update");
    await copyFile(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe"), executable);
    const compile = path.join(root, "compile.ps1");
    await writeFile(compile, `param([string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -OutputAssembly $OutputFile -OutputType WindowsApplication -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
[assembly: AssemblyVersion("0.0.1.0")]
[assembly: AssemblyFileVersion("0.0.1.0")]
public static class Fixture {
  public static int Main(string[] args) {
    if (args[0] == "/S") {
      File.Copy(Assembly.GetExecutingAssembly().Location, Environment.GetEnvironmentVariable("UPDATE_FIXTURE_EXE"), true);
      return 0;
    }
    if (!args[0].StartsWith("--manual-update-job=")) return 2;
    string receipt = Path.Combine(Environment.GetEnvironmentVariable("UPDATE_FIXTURE_JOB"), "launch.json");
    File.WriteAllText(receipt + ".tmp", "{\\"version\\":\\"0.0.1\\",\\"pid\\":" + Process.GetCurrentProcess().Id + "}");
    File.Move(receipt + ".tmp", receipt);
    Thread.Sleep(2000);
    return 0;
  }
}
'@
`);
    const exec = promisify(execFile);
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", compile, installer], { windowsHide: true, timeout: 30_000 });
    const bytes = await readFile(installer);
    const request = path.join(job, "request.json");
    await writeFile(request, JSON.stringify({
      schema: "mycellios-manual-update/1", profile, executable, oldPid: 2147483647, installer,
      version: "0.0.1", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    }));
    await writeFile(path.join(job, "commit.json"), '{"approved":true}');
    const helper = path.join(import.meta.dirname, "manual-update-helper.ps1");
    const runner = path.join(root, "run-fixture.ps1");
    // This fixture copies only a few kilobytes. Simulate the disk capacity
    // check so the test does not depend on the runner having 6 GiB available.
    await writeFile(runner, `param([string]$Helper,[string]$Request)
function Get-PSDrive { [pscustomobject]@{Free=20GB} }
& $Helper -ConfigFile $Request
exit $LASTEXITCODE`);
    const resultFile = path.join(job, "result.json");
    await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", runner, helper, request], {
      env: { ...process.env, UPDATE_FIXTURE_EXE: executable, UPDATE_FIXTURE_JOB: job },
      windowsHide: true, timeout: 60_000,
    }).catch(async (cause: unknown) => {
      const receipt = await readFile(resultFile, "utf8").catch(() => "");
      const progress = await readFile(path.join(job, "progress.json"), "utf8").catch(() => "");
      throw new Error(`Windows helper failed: ${receipt || progress || "no receipt"}`, { cause });
    });
    const result = await readFile(resultFile, "utf8");
    expect(JSON.parse(result.replace(/^\uFEFF/, ""))).toMatchObject({
      installed: true, version: "0.0.1", reopened: true, draftStoresPreserved: true, draftStoreFiles: 1,
    });
    expect(await readFile(draft, "utf8")).toBe("draft from before the update");
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 95_000);
