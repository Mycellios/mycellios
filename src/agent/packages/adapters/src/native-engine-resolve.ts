import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { NativeInstallEngine } from "@mycellios/contracts";
import type { NativeCommand } from "./native-agent-process.js";
import { findNativeCommand } from "./native-agent-process.js";
import type { NativeEngineStoreOptions } from "./native-engine-store.js";
import { compareVersions, managedNativeEngine, nativeCliVersion } from "./native-engine-store.js";
import { nativeSearchEnvironment } from "./native-login-path.js";

export type ResolvedNativeEngine = {
  command: NativeCommand;
  /** configured: an absolute command in native-agents.json; managed: this host's store; path: the person's own CLI. */
  source: "configured" | "managed" | "path";
  version?: string;
  /** False while a managed copy is still being checked; nothing may start it yet. */
  ready: boolean;
};

const PROBE_MS = 10_000;
const versions = new Map<string, { signature: string; value?: string; pending?: Promise<string | undefined> }>();

/** The version the person's own CLI reports, read once per installed file (its size and date). */
async function pathCliVersion(engine: NativeInstallEngine, command: NativeCommand,
  options: { waitMs?: number; version?: NativeEngineStoreOptions["version"] }) {
  // An npm shim runs its script with Node; the script is the file that changes on an update.
  const script = command.args?.[0];
  const info = await stat(script && isAbsolute(script) ? script : command.command).catch(() => null);
  if (!info) return undefined;
  const key = JSON.stringify([command.command, command.args ?? []]);
  const signature = `${info.size}:${info.mtimeMs}`;
  let entry = versions.get(key);
  if (entry?.signature !== signature) {
    // OpenCode's `acp` argument starts its protocol server; the version check runs the program alone.
    const probe = { ...command, args: (command.args ?? []).filter(arg => engine !== "opencode" || arg !== "acp") };
    const pending = (options.version ?? nativeCliVersion)(probe, PROBE_MS).catch(() => undefined);
    const started = { signature, pending };
    entry = started;
    versions.set(key, started);
    void pending.then(value => { if (versions.get(key) === started) versions.set(key, { signature, value }); });
  }
  if (!entry.pending) return entry.value;
  if (options.waitMs === undefined) return entry.pending;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>(resolve => { timer = setTimeout(resolve, options.waitMs, undefined); });
  return Promise.race([entry.pending, late]).finally(() => clearTimeout(timer));
}

/**
 * The command that runs an engine on this host (specs/native-engines/spec.md phase 3): an absolute
 * command in native-agents.json, then the newer of the managed copy and the CLI on PATH (the
 * person's own CLI wins when it is the same version or newer), then the managed copy. PATH includes
 * the login shell's folders on macOS and Linux. `waitMs` bounds discovery's wait for slow checks.
 */
export async function resolveNativeEngine(engine: NativeInstallEngine, options: NativeEngineStoreOptions & {
  configured?: NativeCommand;
  storeRoot?: string;
  waitMs?: number;
  env?: NodeJS.ProcessEnv;
} = {}): Promise<ResolvedNativeEngine | null> {
  if (options.configured) return { command: options.configured, source: "configured", ready: true };
  const [managed, onPath] = await Promise.all([
    options.storeRoot ? managedNativeEngine(options.storeRoot, engine, options).catch(() => null) : null,
    nativeSearchEnvironment(options.env).then(env => findNativeCommand(engine, env)),
  ]);
  if (!managed) return onPath ? { command: onPath, source: "path", ready: true } : null;
  if (onPath) {
    const version = await pathCliVersion(engine, onPath, options);
    if (version && compareVersions(version, managed.version) >= 0)
      return { command: onPath, source: "path", version, ready: true };
  }
  return { command: managed.command, source: "managed", version: managed.version, ready: managed.ready };
}

/** Tests only. */
export function resetNativeEngineVersions() {
  versions.clear();
}
