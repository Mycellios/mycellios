import { mkdtemp, rm, writeFile, readFile, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinAgentTools } from "./builtin-tools.js";
import { approvalPausedToolResult } from "./approval-effect.js";
import { findNativeCommand, nativeEnvironment } from "./native-agent-process.js";
import { codexPermissionProfile, codexToolContent, discoverNativeEngines, NativeAgentRuntime, nativeToolContent } from "./native-agent-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";
import { HostComputerSandbox } from "./host-computer-sandbox.js";
import { restoreTurnCheckpoint } from "./turn-checkpoint.js";
import { CONVERSATION_STYLE } from "./conversation-style.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
async function setup(engine: NonNullable<AgentRunRequest["agentEngine"]>, extra: string[] = [], fixturePath = fixture) {
  const dataDir = await mkdtemp(join(tmpdir(), "rakazo-native-test-"));
  roots.push(dataDir);
  await writeFile(
    join(dataDir, "native-agents.json"),
    JSON.stringify({ authorizedScopes: [{ userId: "user", spaceId: "space" }] }),
  );
  const runtime = new NativeAgentRuntime({
    dataDir,
    fallback: new ScriptedAgentRuntime(),
    commands: { [engine]: { command: process.execPath, args: [fixturePath, engine === "opencode" ? "acp" : engine, ...extra] } },
  });
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
    const test = await setup("opencode", ["--fixture-load-acp", "--workspace-log", log]);
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
      const tools = test.request.tools.map(tool => ({ ...tool, name: "write_file" }));
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
      const test = await setup(engine);
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
    ).toEqual({ PATH: "/bin" });
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
  expect(await attempt()).toContain("thread/resume");
  test.request.nativeConfig = { modelId: "fixture-model", thinkingLevel: "medium" };
  const switched = await attempt();
  expect(switched).toContain("thread/start");
  expect(switched).toContain("history handoff");
  expect(switched).not.toContain("thread/resume");
  expect(await attempt()).toContain("thread/resume");
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
  expect(await readFile(log, "utf8")).toContain("thread/resume");
  test.request.instructions += "\nConversation context begins at sequence 42. Earlier chat messages are outside this conversation; persistent memories and workspace files remain available.";
  await writeFile(log, ""); await consume();
  const calls = await readFile(log, "utf8");
  expect(calls).toContain("thread/start"); expect(calls).not.toContain("thread/resume");
  expect(await readFile(join(workspace, "kept-note.txt"), "utf8")).toBe("Workspace survives");
});
