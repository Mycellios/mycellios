import { describe, expect, it } from "vitest";
import { gitBashPath, isBashShell, nativeShellCommandArgv } from "./native-shell.js";

describe("native shell selection", () => {
  it("recognises Git Bash and not the WSL launcher", () => {
    expect(isBashShell("C:\\Program Files\\Git\\bin\\bash.exe")).toBe(true);
    expect(isBashShell("/bin/bash")).toBe(true);
    expect(isBashShell("bash.exe")).toBe(true);
    expect(isBashShell("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(false);
    // It is bash, but the resolver must never choose the WSL launcher.
    expect(isBashShell("C:\\Windows\\System32\\bash.exe")).toBe(true);
  });

  it("uses bash login arguments when the host reports Git Bash", () => {
    expect(
      nativeShellCommandArgv("ls -la 2>/dev/null | tail -20", {
        platform: "win32",
        shell: "C:\\Program Files\\Git\\bin\\bash.exe",
      }),
    ).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "-lc",
      "ls -la 2>/dev/null | tail -20",
    ]);
  });

  it("keeps PowerShell on Windows when Git Bash is unavailable", () => {
    const argv = nativeShellCommandArgv("Get-ChildItem", {
      platform: "win32",
      shell: "powershell.exe",
    });
    expect(argv.slice(0, 6)).toEqual([
      "powershell.exe",
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      expect.stringContaining("[Console]::OutputEncoding"),
    ]);
    expect(argv.at(-1)).toContain("Get-ChildItem");
    expect(argv).not.toContain("-lc");
  });

  it("uses a POSIX login shell on other platforms", () => {
    expect(nativeShellCommandArgv("pwd", { platform: "linux", shell: "/bin/sh" })).toEqual([
      "/bin/sh",
      "-lc",
      "pwd",
    ]);
  });
});

describe("Git Bash resolution", () => {
  const env = {
    ProgramFiles: "C:\\Program Files",
    ProgramW6432: "C:\\Program Files",
    LOCALAPPDATA: "C:\\Users\\example\\AppData\\Local",
  };

  it("finds Git for Windows from the standard installation", () => {
    const target = "C:\\Program Files\\Git\\bin\\bash.exe";
    expect(gitBashPath("win32", env, (file) => file === target)).toBe(target);
  });

  it("never selects the WSL bash under System32", () => {
    const wsl = "C:\\Windows\\System32\\bash.exe";
    expect(gitBashPath("win32", { ...env, RAKAZO_GIT_BASH_PATH: wsl }, (file) => file === wsl)).toBeNull();
  });

  it("returns null when Git for Windows is not installed", () => {
    expect(gitBashPath("win32", env, () => false)).toBeNull();
  });

  it("does not invent a shell on other platforms", () => {
    expect(gitBashPath("linux", env, () => true)).toBeNull();
  });
});
