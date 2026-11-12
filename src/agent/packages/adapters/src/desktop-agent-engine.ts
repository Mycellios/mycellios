import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRuntime } from "@rakazo/adapter-kit";
import { NativeAgentRuntime } from "./native-agent-runtime.js";
import { PiAgentRuntime } from "./pi-runtime.js";
import { desktopAgentSegmentId } from "./desktop-agent-segment.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** One owned native engine; account/server scopes and uncertain starts survive a restart. */
export function createDesktopAgentEngine(profile: string, accessScope: () => string | undefined,
  createRuntime?: (directory: string, authorized: () => boolean) => AgentRuntime): AgentRuntime {
  const active = new Map<string, { runtime: AgentRuntime; localId: string }>();
  const makeRuntime = createRuntime ?? ((dataDir, authorized) => new NativeAgentRuntime({ dataDir, fallback: new PiAgentRuntime(), hostAccess: authorized }));
  return {
    describe: () => new PiAgentRuntime().describe(),
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
      const runtime = makeRuntime(directory, () => accessScope() === scope), localId = hash([scope, request.runId]);
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
