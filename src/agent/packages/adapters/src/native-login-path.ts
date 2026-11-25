import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix } from "node:path";

/**
 * The PATH of the person's login shell (specs/native-engines/spec.md phase 3). An app opened from
 * Finder or a Linux launcher starts with a minimal PATH, so a CLI installed with Homebrew, npm or
 * a vendor script is missing from it. The shell is read once per session, bounded, and only its
 * PATH is kept; Windows apps already inherit the person's PATH.
 */
const MARK = "__MYCELLIOS_PATH__";
const PROBE_MS = 5_000;
/** A shell that gave no PATH is asked again after this long, not on every discovery. */
const RETRY_MS = 10 * 60_000;
const MAX_ENTRIES = 256;

export type LoginShellRunner = (shell: string, args: string[], timeoutMs: number) => Promise<string>;

let cached: { at: number; value: string | null } | undefined;
let pending: Promise<string | null> | undefined;

/** The PATH between the markers the probe prints, keeping only absolute folders. */
export function parseLoginShellPath(output: string): string | null {
  const start = output.indexOf(MARK);
  const end = output.lastIndexOf(MARK);
  if (start < 0 || end <= start) return null;
  const entries = output.slice(start + MARK.length, end).trim().split(posix.delimiter)
    .filter(entry => posix.isAbsolute(entry) && !/[\0\r\n]/.test(entry)).slice(0, MAX_ENTRIES);
  return entries.length ? entries.join(posix.delimiter) : null;
}

/** The person's shell when it is a known POSIX-style one, else the platform default. */
export function loginShell(env: NodeJS.ProcessEnv = process.env, platformName: NodeJS.Platform = process.platform,
  exists: (file: string) => boolean = existsSync) {
  const shell = env.SHELL;
  if (shell && posix.isAbsolute(shell) && /\/(?:ba|z|fi|k|da)?sh$/.test(shell) && exists(shell)) return shell;
  return platformName === "darwin" ? "/bin/zsh" : "/bin/sh";
}

const runShell: LoginShellRunner = (shell, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(shell, args, {
    cwd: homedir(), timeout: timeoutMs, maxBuffer: 256 * 1024, windowsHide: true,
    // Interactive start files may offer updates or start a multiplexer; neither should run here.
    env: { ...process.env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false" },
  }, (error, stdout) => {
    // A start file that fails can still print the PATH; only an empty answer is a failure.
    if (error && !stdout) reject(error);
    else resolve(String(stdout));
  });
});

/** Reads the login shell's PATH once (an interactive login shell, as a terminal would start). */
export function loginShellPath(options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv;
  run?: LoginShellRunner; now?: () => number } = {}): Promise<string | null> {
  const now = options.now ?? Date.now;
  if (cached && (cached.value !== null || now() - cached.at < RETRY_MS)) return Promise.resolve(cached.value);
  const platformName = options.platform ?? process.platform;
  if (platformName === "win32") return Promise.resolve(null);
  pending ??= (options.run ?? runShell)(loginShell(options.env, platformName),
    ["-ilc", `printf '${MARK}'; printenv PATH; printf '${MARK}'`], PROBE_MS)
    .then(parseLoginShellPath, () => null)
    .then(value => {
      cached = { at: now(), value };
      pending = undefined;
      return value;
    });
  return pending;
}

/** `path` with the login shell's folders first, once they were read; undefined before that. */
export function withLoginShellPath(path: string | undefined, login = cached?.value): string | undefined {
  if (!login) return undefined;
  const entries = [...login.split(posix.delimiter), ...(path ?? "").split(posix.delimiter)].filter(Boolean);
  return [...new Set(entries)].join(posix.delimiter);
}

/** The environment to look for CLIs in: the process's own, plus the login shell's PATH. */
export async function nativeSearchEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const login = await loginShellPath();
  const path = withLoginShellPath(env.PATH, login);
  return path ? { ...env, PATH: path } : env;
}

/** Tests only. */
export function resetLoginShellPath() {
  cached = undefined;
  pending = undefined;
}
