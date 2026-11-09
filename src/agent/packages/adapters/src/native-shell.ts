import { existsSync } from "node:fs";
import path from "node:path";

/** A POSIX shell on Windows must be Git Bash, never the WSL launcher. */
export function isBashShell(shell: string): boolean {
  return /(^|[\\/])bash(?:\.exe)?$/i.test(shell);
}

/**
 * Resolve Git for Windows' bash. The `bash.exe` under System32 starts WSL, which
 * has a different filesystem and no Windows tools, so it is deliberately excluded.
 * An operator can point at another Git installation explicitly.
 */
export function gitBashPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
): string | null {
  if (platform !== "win32") return null;
  const win = path.win32;
  const candidates = [
    env.MYCELLIOS_GIT_BASH_PATH,
    env.RAKAZO_GIT_BASH_PATH,
    env.ProgramFiles && win.join(env.ProgramFiles, "Git", "bin", "bash.exe"),
    env.ProgramW6432 && win.join(env.ProgramW6432, "Git", "bin", "bash.exe"),
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    env.LOCALAPPDATA && win.join(env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (win.basename(candidate).toLowerCase() !== "bash.exe") continue;
    if (/[\\/]windows[\\/]system32[\\/]/i.test(candidate)) continue;
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Interpreter arguments for commands on a native host, independent of the backend's OS. */
export function nativeShellCommandArgv(
  command: string,
  environment: { platform: string; shell: string },
): string[] {
  // A bash shell keeps the POSIX syntax, pipes and quoting the agent already uses.
  if (isBashShell(environment.shell)) return [environment.shell, "-lc", command];
  if (environment.platform === "win32") {
    // Windows PowerShell 5.1 otherwise writes the OEM code page and mangles accents.
    const utf8 =
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();$OutputEncoding=[Text.UTF8Encoding]::new();";
    return [environment.shell, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", utf8 + command];
  }
  return [environment.shell, "-lc", command];
}
