import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRuntime, NativeEngineState } from "@mycellios/adapter-kit";
import { NativeEngineAccountRequestSchema } from "@mycellios/contracts";
import { nativeEngineAccount, type NativeAccountHost } from "./native-account.js";
import { nativeSignInState } from "./native-signin.js";
import { nativeCodexUsageState } from "./native-usage.js";
import { discoverNativeEngines, NativeAgentRuntime, nativeEngineCommand, nativeEngineModels, signedInEngines, signedOutEngines } from "./native-agent-runtime.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { desktopAgentSegmentId } from "./desktop-agent-segment.js";
import { NATIVE_PROCESS_LIMIT, NativeProcessSlots } from "./native-process-slots.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/**
 * One owned native engine; account/server scopes and uncertain starts survive a restart.
 * `processSlots` bounds the CLI processes this PC runs for turns at once: every run shares it.
 */
export function createDesktopAgentEngine(profile: string, accessScope: () => string | undefined,
  createRuntime?: (directory: string, authorized: () => boolean, processSlots: NativeProcessSlots) => AgentRuntime,
  accountHost: NativeAccountHost = {}, processSlots = new NativeProcessSlots(NATIVE_PROCESS_LIMIT)): AgentRuntime {
  const active = new Map<string, { runtime: AgentRuntime; localId: string }>();
  const makeRuntime = createRuntime ?? ((dataDir, authorized, slots) =>
    new NativeAgentRuntime({ dataDir, fallback: new PiAgentRuntime(), hostAccess: authorized, processSlots: slots }));
  async function engineState(): Promise<NativeEngineState> {
    const scope = accessScope();
    if (!scope || !/^[a-f0-9]{64}$/.test(scope)) return { engines: [], signedOut: [] };
    const available = await discoverNativeEngines(path.join(profile, "agent-executor", scope));
    if (accessScope() !== scope) return { engines: [], signedOut: [] };
    return {
      engines: available.flatMap(({ id, available }) =>
        available && (id === "codex" || id === "claude" || id === "opencode") ? [id] : [],
      ),
      signedOut: signedOutEngines(available),
      signedIn: signedInEngines(available),
      models: nativeEngineModels(available),
      account: true,
    };
  }
  return {
    describe: () => new PiAgentRuntime().describe(),
    async nativeEngines() {
      return (await engineState()).engines;
    },
    nativeEngineState: () => engineState(),
    // The same account scope as discovery: a PC signs its CLIs in or out only for its owner.
    async nativeEngineAccount(input) {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope)) throw Error("Desktop account access is unavailable");
      const request = NativeEngineAccountRequestSchema.parse(input);
      const command = await nativeEngineCommand(request.engine, path.join(profile, "agent-executor", scope));
      if (accessScope() !== scope) throw Error("Desktop account changed before signing in");
      return nativeEngineAccount(request, command, accountHost);
    },
    // Plan usage only for a Codex whose CLI confirmed a sign-in; never for another account scope.
    async nativeEngineUsage() {
      const scope = accessScope();
      if (!scope || !/^[a-f0-9]{64}$/.test(scope)) return {};
      const command = await nativeEngineCommand("codex", path.join(profile, "agent-executor", scope));
      if (!command || await nativeSignInState("codex", command) !== true) return {};
      const codex = await nativeCodexUsageState(command);
      return accessScope() === scope && codex ? { codex } : {};
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
      const runtime = makeRuntime(directory, () => accessScope() === scope, processSlots), localId = hash([scope, request.runId]);
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
