import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRuntime, NativeEngineState } from "@mycellios/adapter-kit";
import { NativeEngineAccountRequestSchema, NativeEngineInstallRequestSchema } from "@mycellios/contracts";
import { nativeEngineAccount, type NativeAccountHost } from "./native-account.js";
import { nativeSignInState } from "./native-signin.js";
import { nativeCodexUsageState } from "./native-usage.js";
import { nativeCommandAvailable } from "./native-agent-process.js";
import { discoverNativeEngines, NativeAgentRuntime, nativeEngineCommand, nativeEngineModels, signedInEngines, signedOutEngines } from "./native-agent-runtime.js";
import { nativeEngineInstalls, nativeEngineStoreRoot } from "./native-engine-store.js";
import type { NativeEngineUpdateOptions } from "./native-engine-updates.js";
import { NativeEngineUpdates } from "./native-engine-updates.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { desktopAgentSegmentId } from "./desktop-agent-segment.js";
import { NATIVE_PROCESS_LIMIT, NativeProcessSlots } from "./native-process-slots.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const STORE_ENGINES = ["codex", "claude", "opencode"] as const;
export type DesktopEngineStoreOptions = NativeEngineUpdateOptions & {
  /** Read the CLIs' vendor channels and the blocklist at startup and daily (the app; tests call check). */
  checkUpdates?: boolean;
};
/**
 * One owned native engine; account/server scopes and uncertain starts survive a restart.
 * `processSlots` bounds the CLI processes this PC runs for turns at once: every run shares it.
 */
export function createDesktopAgentEngine(profile: string, accessScope: () => string | undefined,
  createRuntime?: (directory: string, authorized: () => boolean, processSlots: NativeProcessSlots) => AgentRuntime,
  accountHost: NativeAccountHost = {}, processSlots = new NativeProcessSlots(NATIVE_PROCESS_LIMIT),
  /** Update checks for the app; tests also pass a fixture lock, registry and version check. */
  store: DesktopEngineStoreOptions = {}): AgentRuntime {
  const active = new Map<string, { runtime: AgentRuntime; localId: string }>();
  // One store of managed CLIs per PC user, shared by the accounts signed in on this profile.
  const storeRoot = nativeEngineStoreRoot(profile);
  // Its updates: offers, the blocklist, and holding an engine's new turns while it is updated.
  const updates = new NativeEngineUpdates(storeRoot, store);
  if (store.checkUpdates) {
    updates.start();
    // Each CLI's sign-in and models take seconds to read: read them once the account is known, so
    // the first model picker already lists them.
    const warm = setInterval(() => {
      if (!accessScope()) return;
      clearInterval(warm);
      void engineState().catch(() => undefined);
    }, 5_000);
    warm.unref?.();
  }
  const makeRuntime = createRuntime ?? ((dataDir, authorized, slots) => new NativeAgentRuntime({
    dataDir, fallback: new PiAgentRuntime(), hostAccess: authorized, processSlots: slots, storeRoot, engineUpdates: updates,
  }));
  let current: { scope: string; runtime: AgentRuntime } | undefined;
  const releaseIdleNativeProcesses = async () => {
    await current?.runtime.releaseIdleNativeProcesses?.();
  };
  async function engineState(): Promise<NativeEngineState> {
    const scope = accessScope();
    if (!scope || !/^[a-f0-9]{64}$/.test(scope)) return { engines: [], signedOut: [] };
    const available = await discoverNativeEngines(path.join(profile, "agent-executor", scope), { ...store, storeRoot });
    if (accessScope() !== scope) return { engines: [], signedOut: [] };
    const engines = available.flatMap(({ id, available }) =>
      available && (id === "codex" || id === "claude" || id === "opencode") ? [id] : []);
    // The version each engine runs from the store; a person's own or an operator's CLI is never updated.
    const managed = Object.fromEntries(available.flatMap(entry =>
      "managedVersion" in entry && entry.managedVersion && engines.some(id => id === entry.id) ? [[entry.id, entry.managedVersion]] : []));
    return {
      engines,
      signedOut: signedOutEngines(available),
      signedIn: signedInEngines(available),
      models: nativeEngineModels(available),
      account: true,
      install: true,
      installable: STORE_ENGINES.flatMap(engine => engines.includes(engine) ? [] : updates.installable(engine) ?? []),
      installs: nativeEngineInstalls(storeRoot),
      updates: updates.offers(managed),
    };
  }
  return {
    describe: () => new PiAgentRuntime().describe(),
    releaseIdleNativeProcesses,
    async nativeEngines() {
      return (await engineState()).engines;
    },
    nativeEngineState: () => engineState(),
    // The same account scope as discovery: a PC signs its CLIs in or out only for its owner.
    async nativeEngineAccount(input) {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope)) throw Error("Desktop account access is unavailable");
      const request = NativeEngineAccountRequestSchema.parse(input);
      const command = await nativeEngineCommand(request.engine, path.join(profile, "agent-executor", scope), { ...store, storeRoot });
      if (request.engine === "codex" || request.engine === "claude") await releaseIdleNativeProcesses();
      if (accessScope() !== scope) throw Error("Desktop account changed before signing in");
      return nativeEngineAccount(request, command, accountHost);
    },
    // Plan usage only for a Codex whose CLI confirmed a sign-in; never for another account scope.
    async nativeEngineUsage() {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope)) return {};
      const command = await nativeEngineCommand("codex", path.join(profile, "agent-executor", scope), { ...store, storeRoot });
      if (!command || await nativeSignInState("codex", command) !== true) return {};
      const codex = await nativeCodexUsageState(command);
      return accessScope() === scope && codex ? { codex } : {};
    },
    // Installs into this PC user's store only for the PC's own account, like sign-in.
    async nativeEngineInstall(input) {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope)) throw Error("Desktop account access is unavailable");
      const { engine, version } = NativeEngineInstallRequestSchema.parse(input);
      const command = await nativeEngineCommand(engine, path.join(profile, "agent-executor", scope), { ...store, storeRoot });
      const authorize = () => {
        if (accessScope() !== scope) throw Error("Desktop account changed before installing");
      };
      authorize();
      if (engine === "codex" || engine === "claude") await releaseIdleNativeProcesses();
      // The download goes on after this answer; its progress and outcome come with the engines.
      if (version) {
        // Only the version this PC offers, verified like a first install before any turn runs it.
        await updates.update(engine, version, authorize);
        return { status: "installing" };
      }
      if (command && nativeCommandAvailable(command)) return { status: "installed" };
      if (!updates.installable(engine)) throw Error("Its maker publishes no version for this PC.");
      await updates.install(engine, authorize);
      return { status: "installing" };
    },
    abort: async runId => { const owned = active.get(runId); await owned?.runtime.abort(owned.localId); },
    async *run(request, context) {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope) || active.has(request.runId)) throw Error("Desktop account access is unavailable");
      const directory = path.join(profile, "agent-executor", scope), receipts = path.join(directory, "receipts");
      await mkdir(receipts, { recursive: true, mode: 0o700 });
      const segmentId = desktopAgentSegmentId(request);
      // Keep legacy first-start receipts intact. An approved checkpoint has its
      // own durable receipt, so reopening the app cannot replay that segment.
      const receipt = path.join(receipts, hash(segmentId ? [request.botId, request.runId, segmentId] : [request.botId, request.runId]) + ".json");
      try { await writeFile(receipt, JSON.stringify({ version: 1, state: "started", startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          // The desktop owns this run: never execute it twice. Report what the
          // previous attempt actually did so the thread ends interrupted (like a
          // local engine) instead of asking the user to audit an unknown effect.
          const previous = await readFile(receipt, "utf8")
            .then((text) => JSON.parse(text) as { state?: string })
            .catch(() => null);
          throw Error(previous?.state === "completed"
            ? "This run already finished on your PC. Ask again if you need a new answer."
            : "This run was interrupted on your PC. Send a new message to continue.");
        }
        throw Error("Desktop could not record ownership of this run");
      }
      if (accessScope() !== scope || context?.signal?.aborted) throw Error("Desktop account changed before execution");
      if (current?.scope !== scope) {
        const previous = current;
        current = { scope, runtime: makeRuntime(directory, () => accessScope() === scope, processSlots) };
        await previous?.runtime.releaseIdleNativeProcesses?.();
      }
      if (accessScope() !== scope || current.scope !== scope || context?.signal?.aborted)
        throw Error("Desktop account changed before execution");
      const runtime = current.runtime, localId = hash([scope, request.runId]);
      active.set(request.runId, { runtime, localId });
      let completed = false;
      try {
        for await (const event of runtime.run({ ...request, runId: localId }, context)) {
          if (accessScope() !== scope) throw Error("Desktop account changed during execution");
          if (event.type === "done") completed = true;
          yield event;
        }
      } finally {
        await runtime.abort(localId); active.delete(request.runId);
        await writeFile(receipt, JSON.stringify({ version: 1, state: completed ? "completed" : "interrupted", endedAt: new Date().toISOString() }), { mode: 0o600 });
      }
    },
  };
}
