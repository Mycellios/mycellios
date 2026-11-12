import { appendFileSync } from "node:fs";
import readline from "node:readline";

const engine = process.argv[2];
const toolArguments = process.argv.includes("--fixture-questionnaire") ? {
  question: "Your trip", questions: [
    { question: "Where?", options: [{ label: "Paris", description: "Museums" }, "London"], multiSelect: true },
    { question: "When?" },
  ],
} : { path: "notes.txt" };
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const reply = (message, result) => send({ jsonrpc: "2.0", id: message.id, result });
setInterval(() => {}, 1000);
const lines = readline.createInterface({ input: process.stdin });
let bridge;
if (engine === "claude")
  bridge = JSON.parse(process.argv[process.argv.indexOf("--mcp-config") + 1]).mcpServers.rakazo;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const logIndex = process.argv.indexOf("--protocol-log");
  if (logIndex >= 0 && typeof message.method === "string") appendFileSync(process.argv[logIndex + 1], `${message.method}\n`);
  void (async () => {
    if (engine === "codex") {
      if (
        ["thread/start", "thread/resume", "turn/start"].includes(message.method) &&
        (message.params.approvalPolicy !== "untrusted" ||
          message.params.permissions !== "rakazo-runtime" ||
          message.params.sandbox ||
          message.params.sandboxPolicy)
      ) {
        send({
          id: message.id,
          error: { code: -32600, message: "Invalid strict native permission profile" },
        });
        return;
      }
      if (message.method === "initialize") reply(message, { userAgent: "fixture" });
      else if (message.method === "account/rateLimits/read") reply(message, { rateLimits: { primary: { usedPercent: 8, windowDurationMins: 10080, resetsAt: 1900000000 }, secondary: null, planType: "plus" }, accountId: "private-account" });
      else if (message.method === "model/list") reply(message, { data: [{ id: "fixture-model", model: "fixture-model", isDefault: true, serviceTiers: [{ id: "priority" }], supportedReasoningEfforts: [{ reasoningEffort: "medium" }] }] });
      else if (message.method === "thread/start" || message.method === "thread/resume")
        reply(message, { thread: { id: "fixture-thread" } });
      else if (message.method === "turn/start") {
        if (process.argv.includes("--fixture-fast") && (message.params.model !== "fixture-model" || message.params.effort !== "medium" || message.params.serviceTier !== "priority")) throw new Error("Fast settings were not forwarded");
        reply(message, { turn: { id: "fixture-turn" } });
        if (process.argv.includes("--fixture-hang")) return;
        if (process.argv.includes("--fixture-model-unavailable") || process.argv.includes("--fixture-quota")) {
          send({
            method: "turn/started",
            params: { threadId: "fixture-thread", turn: { id: "fixture-turn" } },
          });
          send({
            method: "turn/completed",
            params: {
              threadId: "fixture-thread",
              turn: {
                id: "fixture-turn",
                status: "failed",
                error: { message: JSON.stringify({ error: { code: process.argv.includes("--fixture-quota") ? "insufficient_quota" : "model_not_found", detail: "synthetic-private-token" } }) },
              },
            },
          });
          return;
        }
        send({
          method: "turn/started",
          params: { threadId: "fixture-thread", turn: { id: "fixture-turn" } },
        });
        send({
          id: 901,
          method: "item/tool/call",
          params: {
            threadId: "foreign-thread",
            turnId: "fixture-turn",
            callId: "stale",
            tool: "rakazo_0",
            arguments: {},
          },
        });
        send({
          id: 900,
          method: "item/tool/call",
          params: {
            threadId: "fixture-thread",
            turnId: "fixture-turn",
            callId: "call-1",
            tool: "rakazo_0",
            arguments: toolArguments,
          },
        });
      } else if (message.id === 900) {
        if (!message.result?.success) throw new Error("Tool bridge rejected fixture call");
        send({
          method: "item/agentMessage/delta",
          params: { threadId: "fixture-thread", turnId: "fixture-turn", delta: "Fixture complete" },
        });
        send({
          method: "turn/completed",
          params: { threadId: "fixture-thread", turn: { id: "fixture-turn", status: "completed" } },
        });
      }
    } else if (engine === "claude" && message.type === "user") {
      send({ type: "system", subtype: "init", session_id: "fixture-session" });
      if (process.argv.includes("--fixture-mcp-sdk")) {
        const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
        const { StreamableHTTPClientTransport } = await import(
          "@modelcontextprotocol/sdk/client/streamableHttp.js"
        );
        const client = new Client({ name: "native-fixture", version: "1" });
        await client.connect(
          new StreamableHTTPClientTransport(new URL(bridge.url), {
            requestInit: { headers: bridge.headers },
          }),
        );
        const listed = await client.listTools();
        if (listed.tools.length !== 2 || listed.tools[0].name !== "tool_0")
          throw new Error("Unexpected MCP tool catalog");
        await client.callTool({ name: "tool_0", arguments: toolArguments });
        await client.close();
      } else {
        const response = await fetch(bridge.url, {
          method: "POST",
          headers: {
            Authorization: bridge.headers.Authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "tool_0", arguments: toolArguments },
          }),
        });
        if (!response.ok) throw new Error("MCP bridge failed");
        if (process.argv.includes("--fixture-retry-mcp")) {
          const retried = await fetch(bridge.url, {
            method: "POST",
            headers: {
              Authorization: bridge.headers.Authorization,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: "tool_0", arguments: toolArguments },
            }),
          });
          if (!retried.ok) throw new Error("MCP retry failed");
        }
      }
      send({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "Fixture complete" },
        },
      });
      send({ type: "result", subtype: "success", is_error: false });
    } else if (engine === "acp") {
      if (message.method === "initialize")
        reply(message, {
          protocolVersion: 1,
          agentCapabilities: { mcpCapabilities: { http: true } },
        });
      else if (message.method === "session/new") {
        bridge = message.params.mcpServers[0];
        reply(message, { sessionId: "fixture-acp" });
      } else if (message.method === "session/prompt") {
        const authorization = bridge.headers.find(
          (header) => header.name === "Authorization",
        ).value;
        await fetch(bridge.url, {
          method: "POST",
          headers: { Authorization: authorization, "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "tool_0", arguments: toolArguments },
          }),
        });
        send({
          method: "session/update",
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Fixture complete" },
            },
          },
        });
        reply(message, { stopReason: "end_turn" });
      }
    }
  })().catch(() => process.exit(1));
});
