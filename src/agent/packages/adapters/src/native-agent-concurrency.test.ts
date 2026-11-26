import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopAgentEngine } from "./desktop-agent-engine.js";
import { NativeAgentRuntime } from "./native-agent-runtime.js";
import { NativeProcessSlots, nativeProcessWaitText } from "./native-process-slots.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

// Several conversations of one native Mico at once (specs/native-engines/spec.md phase 4),
// with the fixture CLI: separate processes, sessions and bridge tokens, and the PC's bound.
const roots: string[] = [];
// Kept idle CLIs hold their folders open; end them before removing the folders.
const runtimes: { releaseIdleNativeProcesses?: () => Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.releaseIdleNativeProcesses?.()));
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
type Engine = "codex" | "claude" | "opencode";

async function folder(prefix: string) {
  const path = await mkdtemp(join(tmpdir(), prefix));
  roots.push(path);
  return path;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const lines = async (file: string) =>
  (await readFile(file, "utf8").catch(() => "")).split("\n").filter(Boolean);

/** The one MCP bridge a Claude Code launch was given (its URL and bearer header). */
function launchBridge(args: string[]) {
  const servers = Object.values(JSON.parse(args[args.indexOf("--mcp-config") + 1]!).mcpServers as Record<string, unknown>);
  expect(servers).toHaveLength(1);
  return servers[0] as { url: string; headers: { Authorization: string } };
}

function request(engine: Engine, conversation: string, executeTool: NonNullable<AgentRunRequest["executeTool"]>): AgentRunRequest {
  return {
    agentEngine: engine,
    botId: "bot",
    threadId: `thread-${conversation}`,
    runId: `run-${conversation}`,
    prompt: `Read notes for ${conversation}`,
    instructions: "Use authorized tools",
    history: [],
    model: { provider: `native-${engine}`, id: "default" },
    tools: [{
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    }],
    executeTool,
  };
}

async function collect(runtime: AgentRuntime, input: AgentRunRequest, signal = AbortSignal.timeout(20_000)) {
  const events: AgentRuntimeEvent[] = [];
  for await (const event of runtime.run(input, { spaceId: "space", userId: "user", signal })) events.push(event);
  return events;
}

const answer = (events: AgentRuntimeEvent[]) =>
  events.flatMap((event) => (event.type === "text" ? [event.text] : [])).join("");

describe("native engines running two conversations at once", () => {
  it.each(["codex", "claude", "opencode"] as const)(
    "runs two %s conversations of one Mico side by side in separate processes and sessions",
    async (engine) => {
      const dataDir = await folder("mycellios-native-concurrency-");
      const pids = join(dataDir, "pids.log");
      const launches = join(dataDir, "launches.log");
      const workspaces = join(dataDir, "workspaces.log");
      await writeFile(join(dataDir, "native-agents.json"), JSON.stringify({ authorizedScopes: [{ userId: "user", spaceId: "space" }] }));
      const extra = engine === "claude"
        ? ["--claude-launch-log", launches]
        : engine === "opencode" ? ["--workspace-log", workspaces, "--named-file-tool", "read_file"] : [];
      const runtime = new NativeAgentRuntime({
        dataDir,
        fallback: new ScriptedAgentRuntime(),
        commands: {
          [engine]: {
            command: process.execPath,
            args: [fixture, engine === "opencode" ? "acp" : engine, "--fixture-echo-tool-result", "--fixture-pid-log", pids, ...extra],
          },
        },
      });
      runtimes.push(runtime);
      // Neither tool call answers until both conversations are inside theirs: both CLIs run at once.
      const bothInside = deferred();
      let inside = 0;
      const bridgeChecks: number[] = [];
      const tool = (conversation: string) => vi.fn<NonNullable<AgentRunRequest["executeTool"]>>(async () => {
        inside += 1;
        if (inside === 2) {
          if (engine === "claude") {
            // While both runs are live, one run's bridge token never opens the other run's bridge.
            const [first, second] = (await lines(launches)).map((line) => launchBridge(JSON.parse(line).args as string[]));
            const crossed = await fetch(second!.url, {
              method: "POST",
              headers: { Authorization: first!.headers.Authorization, "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            });
            await crossed.body?.cancel();
            bridgeChecks.push(crossed.status);
          }
          bothInside.resolve();
        }
        await bothInside.promise;
        return { content: `result for ${conversation}` };
      });
      const toolA = tool("a"), toolB = tool("b");
      const [eventsA, eventsB] = await Promise.all([
        collect(runtime, request(engine, "a", toolA)),
        collect(runtime, request(engine, "b", toolB)),
      ]);
      expect(eventsA.at(-1)?.type).toBe("done");
      expect(eventsB.at(-1)?.type).toBe("done");
      // Each conversation got its own tool result back through its own CLI.
      expect(answer(eventsA)).toContain("result for a");
      expect(answer(eventsA)).not.toContain("result for b");
      expect(answer(eventsB)).toContain("result for b");
      expect(answer(eventsB)).not.toContain("result for a");
      expect(toolA).toHaveBeenCalledTimes(1);
      expect(toolB).toHaveBeenCalledTimes(1);
      // Two runs, two CLI processes.
      const started = await lines(pids);
      expect(started).toHaveLength(2);
      expect(new Set(started).size).toBe(2);
      // Each conversation keeps its own private folder.
      const conversations = await readdir(join(dataDir, "native-agents"));
      expect(conversations).toHaveLength(2);
      if (engine !== "opencode") {
        // Codex and Claude Code save the session they resume in their own conversation folder.
        for (const conversation of conversations)
          expect(JSON.parse(await readFile(join(dataDir, "native-agents", conversation, "session.json"), "utf8")).id)
            .toBe(engine === "codex" ? "fixture-thread" : "fixture-session");
      }
      if (engine === "claude") {
        const launched = (await lines(launches)).map((line) => JSON.parse(line) as { cwd: string; args: string[] });
        expect(new Set(launched.map(({ cwd }) => cwd)).size).toBe(2);
        const tokens = launched.map(({ args }) => launchBridge(args).headers.Authorization);
        expect(new Set(tokens).size).toBe(2);
        expect(bridgeChecks).toEqual([403]);
      }
      if (engine === "opencode") {
        // OpenCode keeps a private home per conversation, so two sessions share no CLI state.
        const homes = (await lines(workspaces)).map((line) => JSON.parse(line).home as string);
        expect(homes).toHaveLength(2);
        expect(new Set(homes).size).toBe(2);
      }
    },
    40_000,
  );
});

describe("the PC's bound on native CLI processes", () => {
  async function boundedRuntime(limit: number) {
    const dataDir = await folder("mycellios-native-bound-");
    const pids = join(dataDir, "pids.log");
    await writeFile(join(dataDir, "native-agents.json"), JSON.stringify({ authorizedScopes: [{ userId: "user", spaceId: "space" }] }));
    const slots = new NativeProcessSlots(limit);
    const runtime = new NativeAgentRuntime({
      dataDir,
      fallback: new ScriptedAgentRuntime(),
      commands: { claude: { command: process.execPath, args: [fixture, "claude", "--fixture-pid-log", pids] } },
      processSlots: slots,
    });
    runtimes.push(runtime);
    return { runtime, slots, pids };
  }

  it("makes a turn above the bound wait with its reason, then starts it when a slot frees", async () => {
    const { runtime, slots, pids } = await boundedRuntime(1);
    const release = deferred();
    const firstInside = deferred();
    const first = collect(runtime, request("claude", "a", async () => {
      firstInside.resolve();
      await release.promise;
      return { content: "first" };
    }));
    await firstInside.promise;
    const secondEvents: AgentRuntimeEvent[] = [];
    const secondTool = vi.fn<NonNullable<AgentRunRequest["executeTool"]>>(async () => ({ content: "second" }));
    const second = (async () => {
      for await (const event of runtime.run(request("claude", "b", secondTool), { spaceId: "space", userId: "user", signal: AbortSignal.timeout(20_000) }))
        secondEvents.push(event);
    })();
    await vi.waitFor(() => expect(secondEvents[0]).toEqual({ type: "progress", text: nativeProcessWaitText(1), activity: true }), { timeout: 10_000 });
    expect(slots.state).toEqual({ running: 1, waiting: 1 });
    // The waiting turn has not started a CLI or called a tool.
    expect(await lines(pids)).toHaveLength(1);
    expect(secondTool).not.toHaveBeenCalled();
    release.resolve();
    expect((await first).at(-1)?.type).toBe("done");
    await second;
    expect(secondEvents.at(-1)?.type).toBe("done");
    // The waiting line clears once the turn starts, before anything else it shows.
    expect(secondEvents[1]).toEqual({ type: "progress", text: "", activity: true });
    expect(secondTool).toHaveBeenCalledTimes(1);
    expect(await lines(pids)).toHaveLength(2);
    // The first turn did not keep its CLI while a turn waited; the last one keeps its slot idle.
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    await runtime.releaseIdleNativeProcesses();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  }, 40_000);

  it("lets a turn stopped while it waits end without starting a CLI or keeping a slot", async () => {
    const { runtime, slots, pids } = await boundedRuntime(1);
    const release = deferred();
    const firstInside = deferred();
    const first = collect(runtime, request("claude", "a", async () => {
      firstInside.resolve();
      await release.promise;
      return { content: "first" };
    }));
    await firstInside.promise;
    const stop = new AbortController();
    const stoppedTool = vi.fn<NonNullable<AgentRunRequest["executeTool"]>>(async () => ({ content: "never" }));
    const stoppedEvents: AgentRuntimeEvent[] = [];
    const stopped = (async () => {
      for await (const event of runtime.run(request("claude", "b", stoppedTool), { spaceId: "space", userId: "user", signal: stop.signal }))
        stoppedEvents.push(event);
    })();
    await vi.waitFor(() => expect(slots.state).toEqual({ running: 1, waiting: 1 }), { timeout: 10_000 });
    stop.abort();
    await stopped;
    expect(stoppedEvents.some((event) => event.type === "done")).toBe(false);
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    release.resolve();
    expect((await first).at(-1)?.type).toBe("done");
    expect(stoppedTool).not.toHaveBeenCalled();
    expect(await lines(pids)).toHaveLength(1);
    // Its finished CLI stays idle for the same conversation until released.
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    await runtime.releaseIdleNativeProcesses();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  }, 40_000);

  it("reuses the Desktop runtime within a scope and shares one bound of six across scopes", async () => {
    const root = await folder("mycellios-desktop-bound-");
    let scope = "e".repeat(64);
    const seen: NativeProcessSlots[] = [];
    const engine = createDesktopAgentEngine(root, () => scope, (_directory, _authorized, slots) => {
      seen.push(slots);
      return { describe: () => new ScriptedAgentRuntime().describe(), abort: async () => undefined, async *run() { yield { type: "done" as const }; } };
    });
    for (const conversation of ["a", "b"])
      expect((await collect(engine, request("claude", conversation, async () => ({ content: "" })))).at(-1)?.type).toBe("done");
    expect(seen).toHaveLength(1);

    scope = "f".repeat(64);
    expect((await collect(engine, request("claude", "c", async () => ({ content: "" })))).at(-1)?.type).toBe("done");
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]!.limit).toBe(6);
  });

  it("holds a Desktop turn above the PC's bound in line through the Desktop engine", async () => {
    const root = await folder("mycellios-desktop-engine-bound-");
    const scope = "f".repeat(64);
    const directory = join(root, "agent-executor", scope);
    await mkdir(directory, { recursive: true });
    const pids = join(root, "pids.log");
    await writeFile(join(directory, "native-agents.json"), JSON.stringify({
      claude: { command: process.execPath, args: [fixture, "claude", "--fixture-pid-log", pids] },
    }));
    const slots = new NativeProcessSlots(1);
    const engine = createDesktopAgentEngine(root, () => scope, undefined, {}, slots);
    runtimes.push(engine);
    const release = deferred();
    const firstInside = deferred();
    const first = collect(engine, request("claude", "a", async () => {
      firstInside.resolve();
      await release.promise;
      return { content: "first" };
    }));
    await firstInside.promise;
    const secondEvents: AgentRuntimeEvent[] = [];
    const second = (async () => {
      for await (const event of engine.run(request("claude", "b", async () => ({ content: "second" })), { spaceId: "space", userId: "user", signal: AbortSignal.timeout(20_000) }))
        secondEvents.push(event);
    })();
    await vi.waitFor(() => expect(secondEvents[0]).toEqual({ type: "progress", text: nativeProcessWaitText(1), activity: true }), { timeout: 10_000 });
    expect(await lines(pids)).toHaveLength(1);
    release.resolve();
    expect((await first).at(-1)?.type).toBe("done");
    await second;
    expect(secondEvents.at(-1)?.type).toBe("done");
    expect(await lines(pids)).toHaveLength(2);
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    await engine.releaseIdleNativeProcesses?.();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
  }, 40_000);
});
