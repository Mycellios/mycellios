import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunRequest, AgentRuntimeEvent } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { findNativeCommand } from "./native-agent-process.js";
import { NativeAgentRuntime } from "./native-agent-runtime.js";
import { ScriptedAgentRuntime } from "./scripted-runtime.js";

const selected = new Set((process.env.VERIFY_NATIVE_ENGINES ?? "").split(","));
for (const engine of ["codex", "claude", "acp"] as const) {
  (selected.has(engine) ? describe : describe.skip)(`authenticated ${engine} integration`, () => {
    it("executes the app-owned tool and completes two scoped turns", async () => {
      const root = await mkdtemp(join(tmpdir(), "rakazo-native-live-"));
      const safeRoot = resolve(root);
      if (
        !safeRoot.startsWith(resolve(tmpdir()) + sep) ||
        !safeRoot.includes("rakazo-native-live-")
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
