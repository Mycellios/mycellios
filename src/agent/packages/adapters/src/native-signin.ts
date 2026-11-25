import { execFile } from "node:child_process";
import { homedir } from "node:os";
import type { NativeCommand } from "./native-agent-process.js";
import { NativeAgentProcess, nativeEnvironment } from "./native-agent-process.js";

/** Engines whose CLI can report its own sign-in state without a model call. */
export type SignInEngine = "codex" | "claude";

const PROBE_MS = 5_000;
const FRESH_MS = 60_000;
/** Discovery waits this long for a first probe; a slower probe fills the cache for the next read. */
const FIRST_WAIT_MS = 1_500;

/** `claude auth status --json`: only the boolean leaves this function, never the account. */
export function claudeSignedIn(stdout: string): boolean | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (parsed && typeof parsed === "object" && "loggedIn" in parsed && typeof parsed.loggedIn === "boolean") {
      return parsed.loggedIn;
    }
  } catch { /* not a status document */ }
  return undefined;
}

/** Codex app-server `account/read`: `account` is null when nobody is signed in. */
export function codexSignedIn(result: unknown): boolean | undefined {
  if (!result || typeof result !== "object" || !("account" in result)) return undefined;
  if (result.account === null) return false;
  return typeof result.account === "object" ? true : undefined;
}

/**
 * Asks the installed CLI whether it is signed in: read-only, bounded and never a model call,
 * so it spends nothing. Any failure is `undefined` (unknown), never "signed in".
 */
export async function probeNativeSignIn(engine: SignInEngine, command: NativeCommand): Promise<boolean | undefined> {
  const cwd = homedir();
  if (engine === "claude") {
    return new Promise(resolve => {
      execFile(command.command, [...(command.args ?? []), "auth", "status", "--json"], {
        cwd, env: { ...nativeEnvironment(), ELECTRON_RUN_AS_NODE: "1" }, timeout: PROBE_MS,
        windowsHide: true, maxBuffer: 64 * 1024,
      }, (error, stdout) => {
        // A signed-out CLI may exit non-zero and still print its status; a killed one says nothing.
        if (error && "killed" in error && error.killed) return resolve(undefined);
        resolve(claudeSignedIn(String(stdout)));
      });
    });
  }
  let child: NativeAgentProcess | undefined;
  try {
    child = new NativeAgentProcess(command, ["app-server", "-c", "mcp_servers={}"], cwd, () => {}, () => {});
    await child.request("initialize", { clientInfo: { name: "mycellios-sign-in", version: "0.1.0" }, capabilities: { experimentalApi: true } }, PROBE_MS);
    child.send({ method: "initialized", params: {} });
    return codexSignedIn(await child.request("account/read", { refreshToken: false }, PROBE_MS));
  } catch {
    return undefined;
  } finally {
    await child?.stop().catch(() => {});
  }
}

type Entry = { at: number; value: boolean | undefined; pending?: Promise<boolean | undefined> };
const cache = new Map<string, Entry>();

/**
 * Cached sign-in state, so engine discovery stays fast: a fresh answer is reused for a minute,
 * a first probe is awaited briefly and otherwise keeps running for the next read.
 */
export async function nativeSignInState(
  engine: SignInEngine,
  command: NativeCommand,
  options: { probe?: typeof probeNativeSignIn; now?: () => number; waitMs?: number } = {},
): Promise<boolean | undefined> {
  const now = options.now ?? Date.now;
  const key = JSON.stringify([engine, command.command, command.args ?? []]);
  const entry = cache.get(key);
  if (entry && !entry.pending && now() - entry.at < FRESH_MS) return entry.value;
  let pending = entry?.pending;
  if (!pending) {
    pending = (options.probe ?? probeNativeSignIn)(engine, command).catch(() => undefined);
    const started: Entry = { at: entry?.at ?? 0, value: entry?.value, pending };
    cache.set(key, started);
    void pending.then(value => { if (cache.get(key) === started) cache.set(key, { at: now(), value }); });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">(resolve => { timer = setTimeout(() => resolve("late"), options.waitMs ?? FIRST_WAIT_MS); });
  const result = await Promise.race([pending, late]).finally(() => clearTimeout(timer));
  // While a new probe runs, the previous answer is still the best one available.
  return result === "late" ? entry?.value : result;
}

/** Tests only. */
export function resetNativeSignInCache() { cache.clear(); }
