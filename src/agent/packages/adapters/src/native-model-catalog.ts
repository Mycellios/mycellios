import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { NativeCommand } from "./native-agent-process.js";
import { NativeAgentProcess, nativeEnvironment } from "./native-agent-process.js";
import type { NativeCodexModel } from "./native-codex-settings.js";
import { nativeClaudeModels, nativeCodexModels } from "./native-codex-settings.js";
import { nativeOpenCodeModels, openCodeEnvironment, prepareOpenCodeCatalogProfile } from "./opencode-profile.js";

/** Engines whose CLI lists its signed-in account's models without a model call. */
export type CatalogEngine = "codex" | "claude" | "opencode";

const PROBE_MS = 10_000;
const FRESH_MS = 5 * 60_000;
/** Discovery waits this long for a first read; a slower one fills the cache for the next read. */
const FIRST_WAIT_MS = 1_500;

/** Claude Code answers `initialize` before any prompt, so nothing is sent to a model. */
async function probeClaude(command: NativeCommand, cwd: string, timeoutMs: number) {
  let settle: ((value: unknown) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  const answer = new Promise<unknown>((resolve, reject) => { settle = resolve; fail = reject; });
  const child = new NativeAgentProcess(command, [
    "--restricted", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
  ], cwd, (message) => {
    const raw = message as unknown as { type?: unknown; response?: { request_id?: unknown; subtype?: unknown; response?: unknown } };
    if (raw.type !== "control_response" || raw.response?.request_id !== "catalog") return;
    if (raw.response.subtype === "success") settle?.(raw.response.response);
    else fail?.(new Error("Claude Code model catalog unavailable."));
  }, (error) => fail?.(error));
  const timer = setTimeout(() => fail?.(new Error("Claude Code model catalog timed out.")), timeoutMs);
  try {
    child.send({ type: "control_request", request_id: "catalog", request: { subtype: "initialize" } });
    return nativeClaudeModels(await answer);
  } finally {
    clearTimeout(timer);
    await child.stop().catch(() => {});
  }
}

async function probeCodex(command: NativeCommand, cwd: string, timeoutMs: number) {
  const child = new NativeAgentProcess(command, ["app-server", "-c", "mcp_servers={}"], cwd, () => {}, () => {});
  try {
    await child.request("initialize", { clientInfo: { name: "mycellios-model-picker", version: "0.1.0" }, capabilities: { experimentalApi: true } }, timeoutMs);
    child.send({ method: "initialized", params: {} });
    return nativeCodexModels(await child.request("model/list", { includeHidden: false }, timeoutMs));
  } finally { await child.stop().catch(() => {}); }
}

const execFileAsync = promisify(execFile);

/**
 * `opencode models` in a throwaway private profile holding the host's provider credentials and
 * definitions only (no plugins, MCPs or project config): it lists the providers it can reach.
 */
export async function probeOpenCodeModels(command: NativeCommand, timeoutMs = PROBE_MS, sourceHome?: string) {
  const home = await mkdtemp(join(tmpdir(), "mycellios-opencode-models-"));
  try {
    const config = await prepareOpenCodeCatalogProfile(home, sourceHome);
    // The resolved command ends in `acp`, which would start its protocol server instead.
    const args = [...(command.args ?? []).filter(arg => arg !== "acp"), "models", "--verbose"];
    const { stdout } = await execFileAsync(command.command, args, {
      cwd: home, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: "utf8",
      env: { ...nativeEnvironment(), ELECTRON_RUN_AS_NODE: "1", ...openCodeEnvironment(home, config) },
    });
    return nativeOpenCodeModels(stdout, config.model);
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}

/** Reads one installed CLI's model catalog: bounded, read-only and never a model call. */
export function probeNativeModels(engine: CatalogEngine, command: NativeCommand, cwd = homedir()) {
  return engine === "claude" ? probeClaude(command, cwd, PROBE_MS)
    : engine === "opencode" ? probeOpenCodeModels(command)
    : probeCodex(command, cwd, PROBE_MS);
}

type Entry = { at: number; value: NativeCodexModel[] | undefined; pending?: Promise<NativeCodexModel[] | undefined> };
const cache = new Map<string, Entry>();

/**
 * Cached catalog, so engine discovery stays fast: a fresh list is reused for five minutes, an older
 * one is answered at once while the CLI is asked again, and a first read is awaited briefly and
 * otherwise keeps running for the next one. A failure is `undefined`.
 */
export async function nativeModelCatalog(
  engine: CatalogEngine,
  command: NativeCommand,
  options: { probe?: typeof probeNativeModels; now?: () => number; waitMs?: number } = {},
): Promise<NativeCodexModel[] | undefined> {
  const now = options.now ?? Date.now;
  const key = JSON.stringify([engine, command.command, command.args ?? []]);
  const entry = cache.get(key);
  if (entry && !entry.pending && now() - entry.at < FRESH_MS) return entry.value;
  let pending = entry?.pending;
  if (!pending) {
    pending = (options.probe ?? probeNativeModels)(engine, command).catch(() => undefined);
    const started: Entry = { at: entry?.at ?? 0, value: entry?.value, pending };
    cache.set(key, started);
    void pending.then(value => { if (cache.get(key) === started) cache.set(key, { at: now(), value: value ?? started.value }); });
  }
  // Each read starts Claude Code for seconds: the model picker shows the last list meanwhile.
  if (entry?.value !== undefined) return entry.value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<"late">(resolve => { timer = setTimeout(() => resolve("late"), options.waitMs ?? FIRST_WAIT_MS); });
  const result = await Promise.race([pending, late]).finally(() => clearTimeout(timer));
  return result === "late" ? entry?.value : result;
}

/** Tests only. */
export function resetNativeModelCatalogCache() { cache.clear(); }
