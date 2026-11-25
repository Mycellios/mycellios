import { homedir } from "node:os";
import type { AccountPlanLimit } from "@mycellios/contracts";
import type { NativeCommand } from "./native-agent-process.js";
import { NativeAgentProcess } from "./native-agent-process.js";
import { nativeCodexQuota } from "./native-codex-quota.js";

/**
 * Plan usage of the PC's signed-in Codex (specs/native-engines/spec.md phase 2): the app
 * server's `account/rateLimits/read`, never a model call, mapped to allowlisted limit
 * fields only (`nativeCodexQuota`). Reads are bounded and reused for a minute.
 */
const READ_MS = 5_000;
const FRESH_MS = 60_000;
const FIRST_WAIT_MS = 1_500;

export async function readNativeCodexUsage(command: NativeCommand): Promise<AccountPlanLimit | null> {
  let child: NativeAgentProcess | undefined;
  try {
    child = new NativeAgentProcess(command, ["app-server", "-c", "mcp_servers={}"], homedir(), () => {}, () => {});
    await child.request("initialize", { clientInfo: { name: "mycellios-usage", version: "0.1.0" },
      capabilities: { experimentalApi: true } }, READ_MS);
    child.send({ method: "initialized", params: {} });
    return nativeCodexQuota(await child.request("account/rateLimits/read", {}, READ_MS));
  } catch {
    return null;
  } finally {
    await child?.stop().catch(() => undefined);
  }
}

type Entry = { at: number; value: AccountPlanLimit | null; pending?: Promise<AccountPlanLimit | null> };
const cache = new Map<string, Entry>();

/** Cached usage: a fresh reading is reused for a minute; a slow first read answers on the next call. */
export async function nativeCodexUsageState(
  command: NativeCommand,
  options: { read?: typeof readNativeCodexUsage; now?: () => number; waitMs?: number } = {},
): Promise<AccountPlanLimit | null> {
  const now = options.now ?? Date.now;
  const key = JSON.stringify([command.command, command.args ?? []]);
  const entry = cache.get(key);
  if (entry && !entry.pending && now() - entry.at < FRESH_MS) return entry.value;
  let pending = entry?.pending;
  if (!pending) {
    pending = (options.read ?? readNativeCodexUsage)(command).catch(() => null);
    const started: Entry = { at: entry?.at ?? 0, value: entry?.value ?? null, pending };
    cache.set(key, started);
    void pending.then(value => { if (cache.get(key) === started) cache.set(key, { at: now(), value }); });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">(resolve => { timer = setTimeout(() => resolve("late"), options.waitMs ?? FIRST_WAIT_MS); });
  const result = await Promise.race([pending, late]).finally(() => clearTimeout(timer));
  return result === "late" ? entry?.value ?? null : result;
}

/** Tests only. */
export function resetNativeUsageCache() { cache.clear(); }
