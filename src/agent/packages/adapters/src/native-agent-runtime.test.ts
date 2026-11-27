import { mkdtemp, rm, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import { approvalPausedToolResult } from "./approval-effect.js";
import { findNativeCommand, nativeEnvironment } from "./native-agent-process.js";
import { codexPermissionProfile, codexToolContent, discoverNativeEngines, NativeAgentRuntime, nativeToolContent, sessionInstructions } from "./native-agent-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { restoreTurnCheckpoint } from "./turn-checkpoint.js";
import { CONVERSATION_STYLE } from "./conversation-style.js";
import { resetNativeModelCatalogCache } from "./native-model-catalog.js";
import { NativeProcessSlots } from "./native-process-slots.js";

const roots: string[] = [];
const runtimes: NativeAgentRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.releaseIdleNativeProcesses()));
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
async function setup(engine: NonNullable<AgentRunRequest["agentEngine"]>, extra: string[] = [], fixturePath = fixture, processSlots?: NativeProcessSlots) {
  const dataDir = await mkdtemp(join(tmpdir(), "rakazo-native-test-"));
  roots.push(dataDir);
  await writeFile(
    join(dataDir, "native-agents.json"),
    JSON.stringify({ authorizedScopes: [{ userId: "user", spaceId: "space" }] }),
  );
  const runtime = new NativeAgentRuntime({
    dataDir,
    fallback: new ScriptedAgentRuntime(),
    processSlots,
    commands: { [engine]: { command: process.execPath, args: [fixturePath, engine === "opencode" ? "acp" : engine, ...extra] } },
  });
  runtimes.push(runtime);
  const executeTool = vi.fn<NonNullable<AgentRunRequest['executeTool']>>(async () => ({ content: "fixture file" }));
  const onCheckpoint = vi.fn();
  const onUsage = vi.fn();
  const request: AgentRunRequest = {
    agentEngine: engine,
    botId: "bot",
    threadId: "thread",
    runId: "run",
    prompt: "Read notes",
    instructions: "Use authorized tools",
    history: [],
    model: { provider: `native-${engine}`, id: "default" },
    tools: [
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ],
    executeTool,
    onCheckpoint,
    onUsage,
  };
  const context = { spaceId: "space", userId: "user", signal: AbortSignal.timeout(15000) };
  return { runtime, request, context, executeTool, onCheckpoint, onUsage, dataDir };
}

describe("native agent protocol integration", () => {
  it("reuses only the matching Codex process and rejects events from its previous turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "mycellios-codex-process-"));
    roots.push(root);
    const log = join(root, "pids");
    const slots = new NativeProcessSlots(1);
    const test = await setup("codex", ["--fixture-pid-log", log, "--fixture-late-turn"], fixture, slots);
    const turn = async (runId: string, threadId = test.request.threadId) => {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of test.runtime.run({ ...test.request, runId, threadId }, test.context)) events.push(event);
      expect(events.filter(event => event.type === "text")).toEqual([{ type: "text", text: "Fixture complete" }]);
      expect(events.at(-1)?.type).toBe("done");
    };
    const pids = async () => (await readFile(log, "utf8")).trim().split("\n");
    await turn("first");
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    await turn("second");
    expect(await pids()).toHaveLength(1);
    expect(test.executeTool).toHaveBeenCalledTimes(2);
    await turn("other-thread", "private-other-thread");
    expect(await pids()).toHaveLength(2);
    await test.runtime.releaseIdleNativeProcesses();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
    await turn("after-revocation", "private-other-thread");
    expect(await pids()).toHaveLength(3);
  }, 30_000);

  it("keeps a Claude Code process for the same conversation and refuses its bridge while idle", async () => {
    const root = await mkdtemp(join(tmpdir(), "mycellios-claude-process-"));
    roots.push(root);
    const log = join(root, "pids");
    const launches = join(root, "launches");
    const slots = new NativeProcessSlots(1);
    const test = await setup("claude", ["--fixture-pid-log", log, "--claude-launch-log", launches], fixture, slots);
    const turn = async (runId: string, threadId = test.request.threadId) => {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of test.runtime.run({ ...test.request, runId, threadId }, test.context)) events.push(event);
      expect(events.filter(event => event.type === "text")).toEqual([{ type: "text", text: "Fixture complete" }]);
      expect(events.at(-1)?.type).toBe("done");
    };
    const pids = async () => (await readFile(log, "utf8")).trim().split("\n");
    const promptFiles = async () => {
      const found: string[] = [];
      for (const entry of await readdir(test.dataDir, { recursive: true }))
        if (/system-[^/\\]+\.txt$/.test(String(entry))) found.push(String(entry));
      return found;
    };
    await turn("first");
    expect(slots.state).toEqual({ running: 1, waiting: 0 });
    expect(await promptFiles()).toHaveLength(1);
    // While idle, the kept bridge answers no tool call, even with its own token.
    const launch = JSON.parse((await readFile(launches, "utf8")).trim().split("\n")[0]!) as { args: string[] };
    const servers = JSON.parse(launch.args[launch.args.indexOf("--mcp-config") + 1]!).mcpServers as Record<string, unknown>;
    const mcp = Object.values(servers)[0] as { url: string; headers: { Authorization: string } };
    const idleCall = await fetch(mcp.url, {
      method: "POST",
      headers: { Authorization: mcp.headers.Authorization, "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "tool_0", arguments: { path: "x" } } }),
    });
    expect(idleCall.ok).toBe(false);
    expect(test.executeTool).toHaveBeenCalledTimes(1);
    // The next turn binds its own executor; the CLI's repeated request id is a new call.
    await turn("second");
    expect(await pids()).toHaveLength(1);
    expect(test.executeTool).toHaveBeenCalledTimes(2);
    expect(test.executeTool.mock.calls.map(call => call[2])).toSatisfy(
      (ids: string[]) => new Set(ids).size === 2,
    );
    await turn("other-thread", "private-other-thread");
    expect(await pids()).toHaveLength(2);
    expect(await promptFiles()).toHaveLength(1);
    await test.runtime.releaseIdleNativeProcesses();
    expect(slots.state).toEqual({ running: 0, waiting: 0 });
    expect(await promptFiles()).toHaveLength(0);
    await turn("after-revocation", "private-other-thread");
    expect(await pids()).toHaveLength(3);
  }, 30_000);

  it("starts Claude Code again when its model settings change", async () => {
    const root = await mkdtemp(join(tmpdir(), "mycellios-claude-settings-"));
    roots.push(root);
    const log = join(root, "pids");
    const test = await setup("claude", ["--fixture-pid-log", log]);
    const turn = async (runId: string, nativeConfig?: AgentRunRequest["nativeConfig"]) => {
      for await (const event of test.runtime.run({ ...test.request, runId, nativeConfig }, test.context)) void event;
    };
    const started = async () => (await readFile(log, "utf8")).trim().split("\n").length;
    await turn("first");
    expect(await started()).toBe(1);
    // A new model starts a new CLI (after this CLI's own catalog probe), which the next turn keeps.
    await turn("second", { modelId: "fixture-claude" });
    const afterChange = await started();
    expect(afterChange).toBeGreaterThan(1);
    await turn("third", { modelId: "fixture-claude" });
    expect(await started()).toBe(afterChange);
  }, 30_000);

  it("streams real Codex activity ahead of the reply over the Desktop host without exposing reasoning", async () => {
    const test = await setup("codex", ["--fixture-reasoning"]);
    await writeFile(join(test.dataDir, "native-agents.json"), JSON.stringify({
      authorizedScopes: [{ userId: "local", spaceId: "local" }],
    }));
    const token = "a".repeat(64);
    const host = await startHostComputerServer({
      root: test.dataDir, token, hostname: "127.0.0.1", agentRuntime: test.runtime,
    });
    host.setEnabled(true);
    const runtime = new DesktopAgentRuntime({
      fallback: new ScriptedAgentRuntime(),
      select: async () => ({ available: true, preferred: true }),
      transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
        signal: ctx.signal,
      }),
    });
    const events: AgentRuntimeEvent[] = [];
    try {
      for await (const event of runtime.run(test.request, test.context)) {
        if (!events.length) {
          expect(event).toEqual({ type: "progress", text: "Thinking…", activity: true });
          expect(test.executeTool).not.toHaveBeenCalled();
        }
        events.push(event);
      }
    } finally {
      await host.close();
    }
    expect(events.filter(event => event.type === "progress" || event.type === "text")).toEqual([
      { type: "progress", text: "Thinking…", activity: true },
      { type: "text", text: "Fixture complete" },
    ]);
    expect(JSON.stringify(events)).not.toContain("synthetic private");
  }, 25000);

  it("ignores Codex reasoning from a foreign thread or a stale turn", async () => {
    const test = await setup("codex", ["--fixture-stale-reasoning"]);
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(events.some(event => event.type === "progress")).toBe(false);
    expect(events).toContainEqual({ type: "text", text: "Fixture complete" });
  });

  it.each(["codex", "claude", "acp"] as const)("pauses %s with a complete grouped questionnaire", async engine => {
    const test = await setup(engine, ["--fixture-questionnaire"]);
    test.request.tools = [builtinAgentTools.find(tool => tool.name === "ask_user")!];
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    const ask = events.find(event => event.type === "ask");
    expect(ask?.type === "ask" && ask.questions?.[0]?.options[0]?.description).toBe("Museums");
    expect(ask?.type === "ask" && ask.questions?.[1]?.question).toBe("When?");
    expect(test.executeTool).not.toHaveBeenCalled();
    expect(events.some(event => event.type === "text" && event.text.includes("Fixture complete"))).toBe(false);
  }, 25000);

  it("uses the approved project for OpenCode and reloads only that project's session", async () => {
    const projects = await realpath(await mkdtemp(join(tmpdir(), "mycellios-opencode-project-")));
    roots.push(projects);
    const second = await realpath(await mkdtemp(join(tmpdir(), "mycellios-opencode-other-")));
    roots.push(second);
    const direct = await realpath(await mkdtemp(join(tmpdir(), "mycellios-opencode-direct-")));
    roots.push(direct);
    const log = join(projects, "fixture.jsonl");
    const test = await setup("opencode", ["--fixture-load-acp", "--named-file-tool", "write_file", "--workspace-log", log]);
    await writeFile(join(test.dataDir, "native-agents.json"), JSON.stringify({
      authorizedScopes: [{ userId: "local", spaceId: "local" }],
    }));
    const token = "a".repeat(64);
    const host = await startHostComputerServer({
      root: test.dataDir, token, hostname: "127.0.0.1",
      agentRuntime: Object.assign(test.runtime, { nativeEngines: async (): Promise<["opencode"]> => ["opencode"] }),
    });
    const runtime = new DesktopAgentRuntime({
      fallback: new ScriptedAgentRuntime(),
      select: async () => ({ available: true, preferred: true }),
      transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, {
        method: "POST", headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
        signal: ctx.signal,
      }),
    });
    host.setEnabled(true);
    const computer = new HostComputerSandbox(`http://127.0.0.1:${host.port}`, token);
    const run = async (projectSessionId: string | undefined, runId: string) => {
      const projectContext = { ...test.context, projectSessionId, runId, traceId: runId, operationId: runId };
      const ref = { id: "native-project", botId: test.request.botId, kind: "desktop" as const, providerRef: "native-project" };
      const executeTool = vi.fn<NonNullable<AgentRunRequest["executeTool"]>>(async (name, args) => {
        expect(name).toBe("write_file");
        const fileName = (args as { path: string }).path;
        await computer.writeFile(ref, { path: projectSessionId ? fileName : "project/" + fileName, content: Buffer.from(runId) }, projectContext);
        return { content: "Written" };
      });
      const tools = [
        ...test.request.tools.map(tool => ({ ...tool, name: "write_file" })),
        builtinAgentTools.find(tool => tool.name === "schedule_create")!,
      ];
      const events: AgentRuntimeEvent[] = [];
      for await (const event of runtime.run({ ...test.request, runId, tools, executeTool }, {
        ...test.context, projectSessionId,
      })) events.push(event);
      expect(events.at(-1)?.type).toBe("done");
    };
    try {
      expect(await computer.nativeEngines({ ...test.context, botId: test.request.botId, traceId: "probe", operationId: "probe" })).toEqual(["opencode"]);
      const validate = async () => {};
      const releaseFirst = await host.bindTaskProject("first-project", test.request.botId, projects, validate);
      const releaseSecond = await host.bindTaskProject("second-project", test.request.botId, second, validate);
      await run("first-project", "first");
      await run("first-project", "second");
      await run("second-project", "third");
      await expect(run("unknown-project", "rejected")).rejects.toThrow("Link this task on this computer");
      expect(await readFile(join(projects, "notes.txt"), "utf8")).toBe("second");
      expect(await readFile(join(second, "notes.txt"), "utf8")).toBe("third");
      releaseFirst();
      releaseSecond();
      await host.selectProject(test.request.botId, direct);
      await run(undefined, "direct");
      expect(await readFile(join(direct, "notes.txt"), "utf8")).toBe("direct");
    } finally {
      await host.close();
    }
    const records = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(records.map(record => record.method)).toEqual(["session/new", "session/load", "session/new", "session/new"]);
    expect(records.map(record => [record.cwd, record.sessionCwd])).toEqual([
      [projects, projects], [projects, projects], [second, second], [direct, direct],
    ]);
    for (const record of records) expect(record.home).toContain(join(test.dataDir, "native-agents"));
    expect(await readdir(second)).toEqual(["notes.txt"]);
  }, 25000);

  it("refuses to spawn OpenCode if the local project grant changes during setup", async () => {
    const test = await setup("opencode");
    const resolveOpenCodeProject = vi.fn()
      .mockResolvedValueOnce(test.dataDir)
      .mockResolvedValueOnce(undefined);
    const consume = async () => {
      for await (const _event of test.runtime.run(test.request, { ...test.context, resolveOpenCodeProject })) { /* drain */ }
    };
    await expect(consume()).rejects.toThrow("The selected project changed");
    expect(test.executeTool).not.toHaveBeenCalled();
  });

  it("discovers the OpenCode executable as an ACP command", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "rakazo-native-test-"));
    roots.push(dataDir);
    const command = join(dataDir, process.platform === "win32" ? "opencode.exe" : "opencode");
    await writeFile(command, "", { mode: 0o700 });
    expect(findNativeCommand("opencode", { PATH: dataDir })).toEqual({ command, args: ["acp"] });
  });
  it("does not advertise missing executables or directories and does not replace a broken override", async () => {
    const test = await setup("acp");
    await writeFile(join(test.dataDir, "native-agents.json"), JSON.stringify({
      authorizedScopes: [{ userId: "user", spaceId: "space" }],
      acp: { command: join(test.dataDir, "missing-agent.exe") },
      claude: { command: test.dataDir },
    }));
    const engines = await discoverNativeEngines(test.dataDir);
    expect(engines.find(engine => engine.id === "acp")?.available).toBe(false);
    expect(engines.find(engine => engine.id === "claude")?.available).toBe(false);
    const runtime = new NativeAgentRuntime({ dataDir: test.dataDir, fallback: new ScriptedAgentRuntime() });
    const consume = async () => { for await (const _event of runtime.run(test.request, test.context)) { /* consume */ } };
    await expect(consume()).rejects.toThrow("Correct its path or remove the override");
    expect(test.executeTool).not.toHaveBeenCalled();
  });
  it("rejects another user, another Space and a revoked grant before executing a native tool", async () => {
    const test = await setup("codex");
    const consume = async (context: typeof test.context) => {
      for await (const _event of test.runtime.run(test.request, context)) {
        /* consume */
      }
    };
    await expect(consume({ ...test.context, userId: "other-user" })).rejects.toThrow(
      "not authorized",
    );
    await expect(consume({ ...test.context, spaceId: "other-space" })).rejects.toThrow(
      "not authorized",
    );
    await writeFile(
      join(test.dataDir, "native-agents.json"),
      JSON.stringify({ authorizedScopes: [] }),
    );
    await expect(consume(test.context)).rejects.toThrow("not authorized");
    expect(test.executeTool).not.toHaveBeenCalled();
  });

  it.each(["codex", "claude", "acp", "opencode"] as const)(
    "bridges %s tools through the app executor and preserves unknown billing",
    async (engine) => {
      const test = await setup(engine, engine === "opencode" ? ["--named-file-tool", "read_file"] : []);
      const events: AgentRuntimeEvent[] = [];
      for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
      expect(test.executeTool).toHaveBeenCalledOnce();
      expect(test.executeTool.mock.calls[0]?.slice(0, 2)).toEqual([
        "read_file",
        { path: "notes.txt" },
      ]);
      expect(events).toContainEqual({ type: "text", text: "Fixture complete" });
      expect(events.at(-1)).toEqual({ type: "done" });
      expect(test.onUsage).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ costUsd: null, inputTokens: null }),
      );
      const [capture] = test.onCheckpoint.mock.calls[0]!;
      const saved = restoreTurnCheckpoint(capture(), test.request.model);
      expect(saved.systemPrompt).toContain("Mycellios conversation style:");
      expect(saved.systemPrompt).toContain(CONVERSATION_STYLE);
      expect(saved.systemPrompt).toContain(test.request.instructions);
      expect(saved.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "toolCall", name: "read_file" }],
      });
    },
    25000,
  );
  it("grants Codex root read only where its Windows sandbox wrapper requires it", () => {
    expect(codexPermissionProfile("C:\\work", "win32")).toContain('":root"="read"');
    expect(codexPermissionProfile("C:\\work", "win32")).toContain('":minimal"="read"');
    expect(codexPermissionProfile("/work", "linux")).toContain('":root"="deny"');
  });
  it("uses the Codex wire approval policy and the scoped permission profile", async () => {
    const test = await setup("codex");
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(events.at(-1)?.type).toBe("done");
    expect(test.executeTool).toHaveBeenCalledOnce();
  }, 25000);
  it("explains an unavailable CLI model without executing a tool", async () => {
    const test = await setup("codex", ["--fixture-model-unavailable"]);
    await expect(
      (async () => {
        for await (const _event of test.runtime.run(test.request, test.context)) {
          /* drain */
        }
      })(),
    ).rejects.toThrow("configured Codex model is unavailable");
    expect(test.executeTool).not.toHaveBeenCalled();
    expect(test.onUsage).toHaveBeenCalledOnce();
  }, 25000);
  it("explains a failed-turn quota refusal without exposing provider details or running tools", async () => {
    const test = await setup("codex", ["--fixture-quota"]);
    let failure: unknown;
    try { for await (const _event of test.runtime.run(test.request, test.context)) { /* drain */ } }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("usage limit");
    expect((failure as Error).message).not.toContain("synthetic-private-token");
    expect(test.executeTool).not.toHaveBeenCalled();
  }, 25000);
  it("does not execute an MCP tool twice when the CLI retries the same request", async () => {
    const test = await setup("claude", ["--fixture-retry-mcp"]);
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(events.at(-1)?.type).toBe("done");
    expect(test.executeTool).toHaveBeenCalledOnce();
  }, 25000);
  it("supports the real MCP SDK's initialize, discovery and tool-call lifecycle", async () => {
    const test = await setup("claude", ["--fixture-mcp-sdk"]);
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(events.at(-1)?.type).toBe("done");
    expect(test.executeTool).toHaveBeenCalledOnce();
  }, 25000);
  it.each(["codex", "claude", "acp"] as const)(
    "delivers a message the person sent mid-turn to %s at the next tool result, behind the framing note",
    async (engine) => {
      const test = await setup(engine, ["--fixture-echo-tool-result"]);
      const onToolCompleted = vi.fn();
      // Nothing waits when the turn starts; the correction arrives while the tool runs.
      const claimSteering = vi.fn(async (seen: string[]) =>
        claimSteering.mock.calls.length === 1 || seen.includes("steer-1")
          ? []
          : [{ id: "steer-1", messageId: "message-1", text: "Use the March figures instead." }],
      );
      test.request.claimSteering = claimSteering;
      test.request.onToolCompleted = onToolCompleted;
      let text = "";
      for await (const event of test.runtime.run(test.request, test.context))
        if (event.type === "text") text += event.text;
      expect(text).toContain("fixture file");
      expect(text).toContain("Use the March figures instead.");
      expect(text).toContain("mycellios_steering");
      expect(claimSteering).toHaveBeenNthCalledWith(1, []);
      expect(claimSteering).toHaveBeenNthCalledWith(2, []);
      // The tool's own result, as recorded for the chat, is unchanged.
      expect(onToolCompleted.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ result: { content: "fixture file" } }));
    },
    25000,
  );
  it("moves a running shell to the background when a message for the turn waits", async () => {
    const test = await setup("codex");
    test.request.steeringPending = vi.fn(async () => true);
    let yielded: AbortSignal | undefined;
    test.request.executeTool = vi.fn(async (_name, _args, _id, _route, observer) => {
      yielded = observer?.yieldSignal;
      await new Promise<void>((resolve) => observer?.yieldSignal?.addEventListener("abort", () => resolve(), { once: true }));
      return { content: "still running" };
    });
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(yielded?.aborted).toBe(true);
    expect(events.at(-1)?.type).toBe("done");
  }, 25000);
  it("ends the provider turn on approval without reporting completion", async () => {
    const test = await setup("codex");
    test.request.executeTool = vi.fn(async () => approvalPausedToolResult());
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
    expect(events.some((event) => event.type === "tool")).toBe(true);
    expect(events.some((event) => event.type === "done")).toBe(false);
    expect(test.onUsage).toHaveBeenCalledOnce();
  }, 25000);
  it("stops a hung native process when its run is cancelled", async () => {
    const test = await setup("codex", ["--fixture-hang"]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    try {
      for await (const _event of test.runtime.run(test.request, {
        ...test.context,
        signal: controller.signal,
      })) {
        /* drain */
      }
    } finally {
      clearTimeout(timer);
    }
    expect(test.executeTool).not.toHaveBeenCalled();
  }, 25000);
  it("preserves screenshot images as provider image blocks", () => {
    const result = {
      kind: "agent_tool_result",
      content: [{ type: "image", data: "fixture-base64", mimeType: "image/png" }],
    };
    expect(nativeToolContent(result)).toEqual(result.content);
    expect(codexToolContent(result)).toEqual([
      { type: "inputImage", imageUrl: "data:image/png;base64,fixture-base64" },
    ]);
  });
  it("does not pass application credentials to a provider process", () => {
    expect(
      nativeEnvironment({
        PATH: "/bin",
        DATABASE_URL: "private",
        ANTHROPIC_API_KEY: "private",
        RAKAZO_DESKTOP_STACK_TOKEN: "private",
      }),
    ).toEqual({ PATH: "/bin", DISABLE_AUTOUPDATER: "1" });
  });
});

const workFixture = fileURLToPath(new URL('./fixtures/work-continuation.mjs', import.meta.url));
it.each(['codex','claude','acp'] as const)('continues unfinished %s work in its existing session without replaying a completed action', async engine=>{
 const test=await setup(engine,[],workFixture);const events:AgentRuntimeEvent[]=[];
 for await(const event of test.runtime.run(test.request,test.context))events.push(event);
 expect(test.executeTool).toHaveBeenCalledOnce();
 expect(events.filter(e=>e.type==='turn')).toHaveLength(1);
 expect(events.filter(e=>e.type==='done')).toHaveLength(1);
 expect(events.filter(e=>e.type==='text').map(e=>e.text).join('')).toContain('Hecho y verificado.');
});
it.each(['codex','claude','acp'] as const)('reports incomplete %s work after a bounded change of strategy', async engine=>{
 const test=await setup(engine,['--no-progress'],workFixture);
 const consume=async()=>{for await(const _event of test.runtime.run(test.request,test.context)){};};
 await expect(consume()).rejects.toThrow('WORK_INCOMPLETE');
 expect(test.executeTool).toHaveBeenCalledOnce();
});
it.each(['codex','claude','acp'] as const)('continues a silent %s routine without replaying its completed action',async engine=>{
 const test=await setup(engine,[],workFixture);
 test.request.allowSilentEmpty=true;test.request.routineId='routine';
 test.request.saveWorkState=vi.fn(async()=>{});
 const events:AgentRuntimeEvent[]=[];
 for await(const event of test.runtime.run(test.request,test.context))events.push(event);
 expect(test.executeTool).toHaveBeenCalledOnce();
 expect(test.request.saveWorkState).toHaveBeenCalled();
 expect(events.filter(event=>event.type==='done')).toHaveLength(1);
 expect(events.filter(event=>event.type==='text').map(event=>event.text).join('')).toContain('Hecho y verificado.');
});
it.each(['codex','claude','acp'] as const)('waits for the actual background result before finishing %s work', async engine=>{
 const test=await setup(engine,[],workFixture);
 let finished=false;
 test.executeTool.mockImplementation(async(_name,_args,_id,_route,observer)=>{
  observer?.onShellStillRunning?.(new Promise(resolve=>setTimeout(()=>{finished=true;resolve({stdout:'verified output',stderr:'',code:0});},75)));
  return {stdout:'still running',stderr:'',code:null};
 });
 const events:AgentRuntimeEvent[]=[];
 for await(const event of test.runtime.run(test.request,test.context)){if(event.type==='done')expect(finished).toBe(true);events.push(event);}
 expect(test.executeTool).toHaveBeenCalledOnce();
 expect(events.filter(e=>e.type==='turn')).toHaveLength(1);
 expect(events.some(e=>e.type==='done')).toBe(true);
});

it("forwards the saved model, effort and Fast tier through Codex turn/start", async () => {
  const test = await setup("codex", ["--fixture-fast"]);
  test.request.nativeConfig = { modelId: "fixture-model", thinkingLevel: "medium", fastMode: true };
  const events = [];
  for await (const event of test.runtime.run(test.request, test.context)) events.push(event);
  expect(test.executeTool).toHaveBeenCalledOnce();
  expect(events.some(event => event.type === "done")).toBe(true);
});

it("runs Claude Code in the Mico's folder and loads the owner's settings only on their PC", async () => {
  resetNativeModelCatalogCache();
  const logRoot = await mkdtemp(join(tmpdir(), "mycellios-claude-launch-"));
  roots.push(logRoot);
  const folder = await realpath(await mkdtemp(join(tmpdir(), "mycellios-mico-folder-")));
  roots.push(folder);
  const log = join(logRoot, "launch.jsonl");
  const test = await setup("claude", ["--claude-launch-log", log]);
  const drain = async (context: typeof test.context & { resolveNativeWorkspace?: () => Promise<string | undefined> }) => {
    const events: AgentRuntimeEvent[] = [];
    for await (const event of test.runtime.run(test.request, context)) events.push(event);
    return events;
  };
  test.request.nativeConfig = { modelId: "fixture-claude", thinkingLevel: "high", userSettings: true };
  expect((await drain({ ...test.context, resolveNativeWorkspace: async () => folder })).at(-1)?.type).toBe("done");
  // On a server the same saved switch never loads that host's personal configuration.
  expect((await drain(test.context)).at(-1)?.type).toBe("done");
  test.request.nativeConfig = { userSettings: false };
  await drain({ ...test.context, resolveNativeWorkspace: async () => folder });
  const launches = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { cwd: string; args: string[] });
  expect(launches).toHaveLength(3);
  const [owned, server, isolated] = launches;
  expect(owned!.cwd).toBe(folder);
  expect(owned!.args).toEqual(expect.arrayContaining(["--setting-sources", "user", "--model", "fixture-claude", "--effort", "high"]));
  expect(owned!.args).not.toContain("--restricted");
  expect(server!.cwd).not.toBe(folder);
  expect(server!.cwd).toContain("native-agents");
  expect(server!.args).toContain("--restricted");
  expect(server!.args).not.toContain("--setting-sources");
  expect(isolated!.cwd).toBe(folder);
  expect(isolated!.args).toContain("--restricted");
  expect(isolated!.args).not.toContain("--model");
  // Session and prompt files stay in the private folder, never in the Mico's own one.
  expect(await readdir(folder)).toEqual([]);
}, 25000);

it("refuses a Claude Code model or effort the CLI's account catalog does not offer", async () => {
  resetNativeModelCatalogCache();
  const test = await setup("claude");
  const consume = async () => { for await (const _event of test.runtime.run(test.request, test.context)) { /* drain */ } };
  test.request.nativeConfig = { modelId: "gone" };
  await expect(consume()).rejects.toThrow("Claude Code model is unavailable");
  test.request.nativeConfig = { modelId: "fixture-plain", thinkingLevel: "high" };
  await expect(consume()).rejects.toThrow("effort is unavailable");
  expect(test.executeTool).not.toHaveBeenCalled();
}, 25000);

it("hands off conversation history when a native model or engine changes", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "mycellios-native-model-"));
  roots.push(logRoot);
  const log = join(logRoot, "protocol.log");
  const test = await setup("codex", ["--protocol-log", log]);
  test.request.history = [{ role: "user", content: "fixture history marker" }];
  const attempt = async () => {
    await writeFile(log, "");
    const events = [];
    for await (const event of test.runtime.run(test.request, { ...test.context, signal: AbortSignal.timeout(15000) })) events.push(event);
    expect(events.some(event => event.type === "done")).toBe(true);
    return readFile(log, "utf8");
  };
  expect(await attempt()).toContain("history handoff");
  expect(await attempt()).toBe("turn/start\n");
  test.request.nativeConfig = { modelId: "fixture-model", thinkingLevel: "medium" };
  const switched = await attempt();
  expect(switched).toContain("thread/start");
  expect(switched).toContain("history handoff");
  expect(switched).not.toContain("thread/resume");
  expect(await attempt()).toBe("model/list\nturn/start\n");
  test.request.resetNativeSession = true;
  const returned = await attempt();
  expect(returned).toContain("thread/start");
  expect(returned).toContain("history handoff");
  expect(returned).not.toContain("thread/resume");
}, 30_000);


it("starts a fresh native session after a new-chat context change and keeps the workspace", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "mycellios-new-chat-")); roots.push(logRoot);
  const log = join(logRoot, "protocol.log");
  const test = await setup("codex", ["--protocol-log", log]);
  const consume = async () => { for await (const _event of test.runtime.run(test.request, test.context)) { /* fixture protocol */ } };
  await consume();
  const directories = await readdir(join(test.dataDir, "native-agents"));
  const workspace = join(test.dataDir, "native-agents", directories[0]!);
  await writeFile(join(workspace, "kept-note.txt"), "Workspace survives");
  await writeFile(log, ""); await consume();
  expect(await readFile(log, "utf8")).toBe("turn/start\n");
  test.request.instructions += "\nConversation context begins at sequence 42. Earlier chat messages are outside this conversation; persistent memories and workspace files remain available.";
  await writeFile(log, ""); await consume();
  const calls = await readFile(log, "utf8");
  expect(calls).toContain("thread/start"); expect(calls).not.toContain("thread/resume");
  expect(await readFile(join(workspace, "kept-note.txt"), "utf8")).toBe("Workspace survives");
});

describe("the Claude Code session binding", () => {
  it("resumes the session when only memory or notes changed, and starts a new one for other instructions", async () => {
    expect(sessionInstructions("Be brief.\n<durable_memory>\nlikes tea\n</durable_memory>\n<scratchpad_open>- a</scratchpad_open>"))
      .toBe("Be brief.\n<durable_memory/>\n<scratchpad_open/>");
    const root = await mkdtemp(join(tmpdir(), "mycellios-claude-binding-"));
    roots.push(root);
    const launches = join(root, "launches");
    const test = await setup("claude", ["--claude-launch-log", launches]);
    const turn = async (runId: string, instructions: string) => {
      const events: AgentRuntimeEvent[] = [];
      for await (const event of test.runtime.run({ ...test.request, runId, instructions }, test.context)) events.push(event);
      expect(events.at(-1)?.type).toBe("done");
      await test.runtime.releaseIdleNativeProcesses();
    };
    const resumed = async () => {
      const args = JSON.parse((await readFile(launches, "utf8")).trim().split("\n").at(-1)!).args as string[];
      return args.includes("--resume");
    };
    await turn("first", "Use authorized tools\n<durable_memory>\nv1\n</durable_memory>");
    expect(await resumed()).toBe(false);
    await turn("memory-changed", "Use authorized tools\n<durable_memory>\nv2\n</durable_memory>");
    expect(await resumed()).toBe(true);
    await turn("persona-changed", "Answer only in French\n<durable_memory>\nv2\n</durable_memory>");
    expect(await resumed()).toBe(false);
  }, 30_000);
});
