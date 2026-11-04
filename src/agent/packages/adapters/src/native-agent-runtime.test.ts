import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalPausedToolResult } from "./approval-effect.js";
import { nativeEnvironment } from "./native-agent-process.js";
import { codexToolContent, discoverNativeEngines, NativeAgentRuntime, nativeToolContent } from "./native-agent-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";
import { restoreTurnCheckpoint } from "./turn-checkpoint.js";

const roots: string[] = [];
afterEach(async () => {
  for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true });
});
const fixture = fileURLToPath(new URL("./fixtures/native-agent.mjs", import.meta.url));
async function setup(engine: "codex" | "claude" | "acp", extra: string[] = [], fixturePath = fixture) {
  const dataDir = await mkdtemp(join(tmpdir(), "rakazo-native-test-"));
  roots.push(dataDir);
  await writeFile(
    join(dataDir, "native-agents.json"),
    JSON.stringify({ authorizedScopes: [{ userId: "user", spaceId: "space" }] }),
  );
  const runtime = new NativeAgentRuntime({
    dataDir,
    fallback: new ScriptedAgentRuntime(),
    commands: { [engine]: { command: process.execPath, args: [fixturePath, engine, ...extra] } },
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

  it.each(["codex", "claude", "acp"] as const)(
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
      expect(saved.messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [{ type: "toolCall", name: "read_file" }],
      });
    },
    25000,
  );
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
