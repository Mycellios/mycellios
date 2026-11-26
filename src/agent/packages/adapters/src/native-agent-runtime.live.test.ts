import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { findNativeCommand, NativeAgentProcess } from "./native-agent-process.js";
import { NativeAgentRuntime } from "./native-agent-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";
import { nativeCodexModels } from "./native-codex-settings.js";
import { createDesktopAgentEngine } from "./desktop-agent-engine.js";
import { DesktopAgentRuntime } from "./desktop-agent-runtime.js";
import { startHostComputerServer } from "./host-computer-server.js";

const selected = new Set((process.env.VERIFY_NATIVE_ENGINES ?? "").split(","));
for (const engine of ["codex", "claude", "acp"] as const) {
  (selected.has(engine) ? describe : describe.skip)(`authenticated ${engine} integration`, () => {
    it("executes the app-owned tool and completes two scoped turns", async () => {
      const root = await mkdtemp(join(tmpdir(), "mycellios-native-live-"));
      const safeRoot = resolve(root);
      if (
        !safeRoot.startsWith(resolve(tmpdir()) + sep) ||
        !safeRoot.includes("mycellios-native-live-")
      )
        throw new Error("Unexpected fixture path");
      await writeFile(
        join(root, "native-agents.json"),
        JSON.stringify({
          authorizedScopes: [{ userId: "fixture-user", spaceId: "fixture-space" }],
        }),
      );
      const diagnosticFile = join(root, "acp-trace.jsonl");
      let verified = false;
      const nonce = randomUUID();
      const executeTool = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
        content: [{ type: "text", text: JSON.stringify({ nonce, path: args.path }) }],
      }));
      const onUsage = vi.fn();
      const runtime = new NativeAgentRuntime({
        dataDir: root,
        fallback: new ScriptedAgentRuntime(),
        ...(engine === "acp"
          ? {
              commands: {
                acp: process.env.VERIFY_ACP_MODEL
                  ? {
                      command: process.execPath,
                      args: [
                        fileURLToPath(
                          new URL("./fixtures/native-acp-acceptance.mjs", import.meta.url),
                        ),
                        process.env.VERIFY_ACP_COMMAND!,
                        process.env.VERIFY_ACP_MODEL,
                        diagnosticFile,
                      ],
                    }
                  : { command: process.env.VERIFY_ACP_COMMAND!, args: ["acp"] },
              },
            }
          : {}),
        ...(engine === "codex" && process.env.VERIFY_CODEX_MODEL
          ? {
              commands: {
                codex: {
                  ...findNativeCommand("codex")!,
                  args: [
                    ...(findNativeCommand("codex")?.args ?? []),
                    "-c",
                    `model=${JSON.stringify(process.env.VERIFY_CODEX_MODEL)}`,
                    "-c",
                    'model_reasoning_effort="low"',
                  ],
                },
              },
            }
          : {}),
      });
      try {
        for (const path of ["first-fixture.txt", "second-fixture.txt"]) {
          const request: AgentRunRequest = {
            agentEngine: engine,
            botId: "fixture-bot",
            threadId: "fixture-thread",
            runId: randomUUID(),
            prompt: `Call the application read_file tool exactly once with path ${JSON.stringify(path)}. This is a synthetic protocol integration test. Do not use native host tools. After the tool returns, reply briefly and end the turn.`,
            instructions:
              "Only application-provided tools are authorized. No filesystem, shell, browsing or external actions. Use read_file to fetch the requested synthetic fixture.",
            history: [],
            model: { provider: `native-${engine}`, id: "default" },
            tools: [
              {
                name: "read_file",
                description:
                  "Read a synthetic test fixture through the application. This is the only permitted tool.",
                inputSchema: {
                  type: "object",
                  properties: { path: { type: "string" } },
                  required: ["path"],
                  additionalProperties: false,
                },
              },
            ],
            executeTool,
            onUsage,
          };
          const events: AgentRuntimeEvent[] = [];
          for await (const event of runtime.run(request, {
            spaceId: "fixture-space",
            userId: "fixture-user",
            signal: AbortSignal.timeout(120000),
          }))
            events.push(event);
          expect(events.at(-1)?.type).toBe("done");
          expect(executeTool).toHaveBeenLastCalledWith(
            "read_file",
            { path },
            expect.any(String),
            undefined,
          );
          expect(events.some((event) => event.type === "text")).toBe(true);
        }
        expect(executeTool).toHaveBeenCalledTimes(2);
        expect(onUsage).toHaveBeenCalledTimes(2);
        verified = true;
      } finally {
        await runtime.releaseIdleNativeProcesses();
        if (!verified && engine === "acp") {
          const trace = await readFile(diagnosticFile, "utf8").catch(() => "");
          if (trace)
            process.stdout.write(
              `ACP protocol diagnostics: ${trace.split("\n").slice(-12).join("\n")}\n`,
            );
        }
        await rm(safeRoot, { recursive: true, force: true });
      }
    }, 260000);
  });
}

(process.env.VERIFY_CODEX_REUSE ? it : it.skip)("measures a real Codex model with a cold and reused process", async () => {
  const executable = process.env.VERIFY_CODEX_EXECUTABLE;
  const command = executable ? { command: executable } : findNativeCommand("codex");
  if (!command) throw new Error("Install the signed-in Codex CLI.");
  const root = await mkdtemp(join(tmpdir(), "mycellios-codex-latency-"));
  const engine = createDesktopAgentEngine(root, () => "a".repeat(64), (dataDir, hostAccess, processSlots) =>
    new NativeAgentRuntime({ dataDir, hostAccess, processSlots, fallback: new ScriptedAgentRuntime(), commands: { codex: command } }));
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const host = await startHostComputerServer({ root, token, hostname: "127.0.0.1", agentRuntime: engine });
  const runtime = new DesktopAgentRuntime({
    fallback: new ScriptedAgentRuntime(),
    select: async () => ({ available: true, preferred: true }),
    transport: (input, ctx) => fetch(`http://127.0.0.1:${host.port}/computer`, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input), signal: ctx.signal,
    }),
  });
  host.setEnabled(true);
  const calls = vi.spyOn(NativeAgentProcess.prototype, "request");
  try {
    const scope = { userId: "benchmark-user", spaceId: "benchmark-space" };
    const probe = new NativeAgentProcess(command, ["app-server", "-c", "mcp_servers={}"], root, () => {}, () => {});
    let model: string | undefined;
    try {
      await probe.request("initialize", { clientInfo: { name: "mycellios-benchmark", version: "0.1.0" } });
      probe.send({ method: "initialized", params: {} });
      const models = nativeCodexModels(await probe.request("model/list", { includeHidden: false }));
      const lowEffortModels = models.filter(candidate => candidate.thinkingLevels.includes("low"));
      model = process.env.VERIFY_CODEX_MODEL ?? lowEffortModels.find(candidate => candidate.isDefault)?.id ?? lowEffortModels[0]?.id;
      if (!model || !lowEffortModels.some(candidate => candidate.id === model))
        throw new Error(`Requested model unavailable. Supported models at low effort: ${lowEffortModels.map(candidate => candidate.id).join(", ")}`);
    } finally {
      await probe.stop();
    }
    const turns = [];
    for (const phase of ["cold-new", "warm", "cold-resume", "warm-after-resume"] as const) {
      if (phase === "cold-resume") await engine.releaseIdleNativeProcesses?.();
      calls.mockClear();
      const started = performance.now();
      let firstActivityMs: number | undefined;
      let firstTextMs: number | undefined;
      let answer = "";
      let done = false;
      for await (const event of runtime.run({
        agentEngine: "codex",
        botId: "benchmark-bot", threadId: "benchmark-thread", runId: randomUUID(),
        prompt: "Reply with exactly OK. This is a latency check. Do not use tools.",
        instructions: "Reply to the benchmark prompt. No tools or external actions.",
        history: [], tools: [],
        model: { provider: "native-codex", id: "default" },
        nativeConfig: { modelId: model, thinkingLevel: "low" },
      }, { ...scope, signal: AbortSignal.timeout(55_000) })) {
        const ms = Math.round(performance.now() - started);
        if (event.type === "progress" && event.activity && event.text) firstActivityMs ??= ms;
        if (event.type === "text") {
          if (event.text.trim()) firstTextMs ??= ms;
          answer += event.text;
        }
        if (event.type === "done") done = true;
      }
      const methods = calls.mock.calls.map(([method]) => method);
      const sample = { phase, firstActivityMs: firstActivityMs ?? null, firstTextMs, totalMs: Math.round(performance.now() - started), methods };
      turns.push(sample);
      process.stdout.write(`Codex latency ${JSON.stringify({ model, ...sample })}\n`);
      expect(done).toBe(true);
      expect(answer.trim()).toBe("OK");
      expect(firstTextMs).toBeDefined();
    }
    expect(turns.map(turn => turn.methods.filter(method => method !== "model/list"))).toEqual([
      ["initialize", "thread/start", "turn/start"],
      ["turn/start"],
      ["initialize", "thread/resume", "turn/start"],
      ["turn/start"],
    ]);
  } finally {
    calls.mockRestore();
    await host.close();
    await rm(root, { recursive: true, force: true });
  }
}, 245_000);
