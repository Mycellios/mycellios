import { getLogger } from "@rakazo/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpConnector } from "./mcp-connector.js";
import { mcpLaunchSecrets } from "./mcp-launch-secrets.js";
import { McpSession } from "./mcp-transport.js";

afterEach(() => vi.restoreAllMocks());
describe("MCP launch credentials", () => {
  it("recognizes separate/inline flags, headers, numeric secrets and URL passwords", () => {
    const values = mcpLaunchSecrets([
      "--api-key=secret-value",
      "--password",
      "1234",
      "-H",
      "Authorization: Bearer header-token",
      "postgres://user:p%40ss@db.test/db?token=query-token",
      "--port",
      "3000",
    ]);
    expect(values).toEqual(
      expect.arrayContaining([
        "secret-value",
        "1234",
        "Bearer header-token",
        "header-token",
        "p%40ss",
        "p@ss",
        "query-token",
      ]),
    );
    expect(values).not.toContain("3000");
  });
  it("finds JSON headers, environment assignments and camel-case credential names", () => {
    expect(
      mcpLaunchSecrets([
        "--headers",
        '{"Authorization":"Bearer abc123","x-api-key":4321}',
        "--accessToken=short",
        "API_TOKEN=env-secret",
        "--endpoint=https://user:pw@host.test/",
      ]),
    ).toEqual(
      expect.arrayContaining(["Bearer abc123", "abc123", "4321", "short", "env-secret", "pw"]),
    );
    expect(mcpLaunchSecrets(["--port", "3000", "/some/file", "--verbose"])).toEqual([]);
  });
  it.each(["launch", "discovery", "call", "result", "definition"])(
    "redacts credentials from %s without changing child arguments",
    async (phase) => {
      const args = ["--api-key", "launch-secret", "--password=1234"];
      const server = {
        id: "s",
        slug: "demo",
        name: "Demo",
        transport: "stdio",
        command: "node",
        endpoint: null,
        secretId: null,
        args,
        revision: 1,
      };
      const assignment = { server, serverId: "s", allowAllTools: true, allowedTools: [] };
      const prisma = {
        botMcpServer: {
          findMany: vi.fn(async () => [assignment]),
          findFirst: vi.fn(async () => assignment),
        },
        mcpServer: { updateMany: vi.fn(async () => ({ count: 1 })) },
      };
      const log = vi.spyOn(getLogger(), "error").mockImplementation(() => {});
      const launch = vi.spyOn(McpSession.prototype, "connectStdio").mockImplementation(async () => {
        if (phase === "launch") throw new Error("launch-secret 1234");
      });
      vi.spyOn(McpSession.prototype, "close").mockResolvedValue(undefined);
      vi.spyOn(McpSession.prototype, "listTools").mockImplementation(async () => {
        if (phase === "discovery") throw new Error("launch-secret 1234");
        return {
          tools: [
            {
              name: "read",
              description: "uses launch-secret",
              inputSchema: {
                type: "object",
                properties:
                  phase === "definition" ? { password: { type: "number", default: 1234 } } : {},
              },
            },
          ],
        };
      });
      vi.spyOn(McpSession.prototype, "callTool").mockImplementation(async () => {
        if (phase === "call") throw new Error("launch-secret 1234");
        return {
          content: [{ type: "text", text: "launch-secret 1234" }],
          structuredContent: { credential: 1234 },
        };
      });
      const connector = new McpConnector(prisma as never, {} as never, {
        stdioEnabled: true,
        allowedCommands: ["node"],
      });
      const context = {
        spaceId: "w",
        userId: "u",
        botId: "b",
        operationId: "test",
        traceId: "test",
        signal: new AbortController().signal,
      };
      try {
        const tools = await connector.discoverTools(context);
        const events = [];
        if (phase === "call" || phase === "result")
          for await (const event of connector.execute(
            {
              tool: "mcp__demo__read",
              args: {},
              executionId: "test",
              route: { connectorId: "mcp", resourceId: "s", toolName: "read" },
            },
            context,
          ))
            events.push(event);
        expect(launch.mock.calls[0]?.[0].args).toEqual(args);
        expect(JSON.stringify({ tools, events, logs: log.mock.calls })).not.toMatch(
          /launch-secret|1234/,
        );
        if (phase === "definition") expect(tools).toEqual([]);
        else expect(JSON.stringify({ tools, events })).toContain("[redacted]");
        if (phase === "call" || phase === "result") expect(tools).toHaveLength(1);
        if (phase === "result") expect(events[0]).toMatchObject({ type: "result" });
      } finally {
        await connector.close();
      }
    },
  );
});
