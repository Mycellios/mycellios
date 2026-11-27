// Real Pi turn on a local model: Desktop's runtime loads the installed model, Pi calls a
// tool, receives its result and answers. Run verify-local-models.ts first.
// Usage: npx tsx apps/desktop/scripts/verify-local-model-turn.ts <dir> [modelId]
import type { AgentRuntimeEvent } from "@mycellios/adapter-kit";
import { DeviceModelRuntime } from "../../../packages/adapters/src/device-model-runtime.ts";
import { PiAgentRuntime } from "../../../packages/adapters/src/pi-runtime.ts";
import { LocalModels } from "../src/local-models.ts";

const [directory, modelId = "qwen3.5-2b"] = process.argv.slice(2);
if (!directory) throw new Error("Usage: verify-local-model-turn.ts <dir> [modelId]");
const models = new LocalModels(directory);
const runtime = new DeviceModelRuntime(new PiAgentRuntime(), new PiAgentRuntime({ maxEagerToolSchemas: 12, light: true }), (id) => models.endpoint(id));
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) =>
  ({ name, description, inputSchema: { type: "object", properties, required } });
const calls: string[] = [];
try {
  for (const [label, prompt] of [["cold", "¿Qué pone en notas/plan.md? Resúmelo en una frase."], ["warm", "Explícame en dos frases qué es una API."]] as const) {
    const started = performance.now();
    let first: number | undefined;
    let text = "";
    const events: AgentRuntimeEvent[] = [];
    for await (const event of runtime.run({
      botId: "mico", threadId: "thread", runId: `run-${label}`, prompt, history: [],
      instructions: "You are Mico, a helpful assistant on the person's PC. Use tools when needed and answer in the person's language.",
      tools: [
        tool("read_file", "Read a text file from the workspace.", { path: { type: "string" } }, ["path"]),
        tool("list_files", "List files in a folder.", { path: { type: "string" } }, ["path"]),
        tool("web_search", "Search the web.", { query: { type: "string" } }, ["query"]),
      ],
      executeTool: async (name, args) => {
        calls.push(`${name}(${JSON.stringify(args)})`);
        return name === "read_file" ? "# Plan\nLanzar la beta el 15 de diciembre, con modelos locales y pruebas en 3 PCs." : "[]";
      },
      model: { provider: "device", id: modelId, contextWindow: 16384, maxTokens: 2048 },
    }, { userId: "owner", spaceId: "space", botId: "mico", runId: `run-${label}`, traceId: "t", operationId: "o", signal: AbortSignal.timeout(300_000) })) {
      events.push(event);
      if (first === undefined && (event.type === "text" || event.type === "tool_call")) first = performance.now() - started;
      if (event.type === "text") text += event.text;
    }
    console.log(`${label}: first event ${((first ?? 0) / 1000).toFixed(1)} s, total ${((performance.now() - started) / 1000).toFixed(1)} s, done=${events.at(-1)?.type === "done"}`);
    console.log(`  answer: ${JSON.stringify(text.slice(0, 220))}`);
  }
  console.log(`tool calls: ${calls.join(", ") || "none"}`);
} finally {
  await models.unload();
}
