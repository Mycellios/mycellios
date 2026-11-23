import { IsolationError } from "@mycellios/db";
import { describe, expect, it, vi } from "vitest";
import { createMemoryConnections, MAX_MEMORY_CONNECTIONS } from "./memory-connections.js";

const actor = { userId: "user-1", spaceId: "space-1", email: "a@b.com", isDeploymentOwner: false };
const at = new Date("2026-11-23T10:00:00.000Z");

const server = {
  id: "server-1",
  name: "My memory",
  endpoint: "https://memory.example/mcp",
  secretId: null,
};

function setup(
  options: {
    connections?: number;
    probe?: () => Promise<unknown>;
    oauth?: "none" | "connected" | "reconnect";
    awaitsOAuth?: boolean;
    noConnector?: boolean;
  } = {},
) {
  let row = {
    id: "conn-1",
    serverId: server.id,
    spaceId: actor.spaceId,
    userId: actor.userId,
    toolMapping: {},
    status: "unchecked",
    message: null as string | null,
    capabilities: {} as unknown,
    checkedAt: null as Date | null,
    createdAt: at,
    updatedAt: at,
  };
  const findFirst = vi.fn(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === row.id && where.userId === actor.userId ? { ...row, server } : null,
  );
  const update = vi.fn(async ({ data }: { data: Partial<typeof row> }) => {
    row = { ...row, ...data };
    return row;
  });
  const create = vi.fn(async ({ data }: { data: Partial<typeof row> }) => ({ ...row, ...data }));
  const prisma = {
    memoryConnection: {
      findFirst,
      findMany: vi.fn(async () => [{ ...row, server }]),
      count: vi.fn(async () => options.connections ?? 0),
      update,
      create,
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const servers = {
    prepareMcpServer: vi.fn(async () => null),
    insertMcpServer: vi.fn(async () => server),
    removeMcpServerInTransaction: vi.fn(async () => []),
    mcpAwaitsOAuth: vi.fn(async () => options.awaitsOAuth ?? false),
  };
  const probe = vi.fn(options.probe ?? (async () => ({ status: "ok", toolCount: 0, tools: [] })));
  const oauth = {
    summaryFor: vi.fn(async () => ({ status: options.oauth ?? "none", clientId: null })),
  };
  const memory = createMemoryConnections(
    { prisma: prisma as never, mcp: options.noConnector ? undefined : ({ probe } as never) },
    oauth as never,
    servers as never,
  );
  return { memory, prisma, servers, probe, update };
}

const profileTools = [
  {
    name: "memory_search",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "memory_read",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    annotations: { readOnlyHint: true },
  },
];

describe("memory connections", () => {
  it("creates a personal streamable HTTP server through the shared MCP checks", async () => {
    const { memory, servers, prisma } = setup();
    const created = await memory.create(actor, {
      name: "My memory",
      endpoint: "https://memory.example/mcp",
      token: "token-value-123",
      toolMapping: {},
    });
    const config = servers.prepareMcpServer.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(config).toMatchObject({
      transport: "streamable_http",
      endpoint: "https://memory.example/mcp",
      secret: "token-value-123",
    });
    expect(String(config.slug)).toMatch(/^memory-[0-9a-f]{12}$/);
    expect(prisma.memoryConnection.create).toHaveBeenCalledWith({
      data: { spaceId: actor.spaceId, userId: actor.userId, serverId: server.id, toolMapping: {} },
    });
    expect(created).toMatchObject({ status: "unchecked", name: "My memory", serverId: server.id });
    expect(JSON.stringify(created)).not.toContain("token-value-123");
  });

  it("refuses more connections than the limit", async () => {
    const { memory, servers } = setup({ connections: MAX_MEMORY_CONNECTIONS });
    await expect(
      memory.create(actor, { name: "x", endpoint: "https://m.example/mcp", toolMapping: {} }),
    ).rejects.toThrow(/At most/);
    expect(servers.prepareMcpServer).not.toHaveBeenCalled();
  });

  it("marks a server that implements the profile as compatible", async () => {
    const { memory } = setup({
      probe: async () => ({ status: "ok", message: null, toolCount: 2, tools: profileTools }),
    });
    const checked = await memory.check(actor, "conn-1");
    expect(checked).toMatchObject({
      status: "compatible",
      capabilities: { read: true, write: false, forget: false },
    });
  });

  it("marks a server without the profile as incompatible and grants nothing", async () => {
    const { memory } = setup({
      probe: async () => ({ status: "ok", message: null, toolCount: 1, tools: [profileTools[0]] }),
    });
    const checked = await memory.check(actor, "conn-1");
    expect(checked.status).toBe("incompatible");
    expect(checked.message).toContain("memory_read");
    expect(checked.capabilities.read).toBe(false);
  });

  it("asks for authorization instead of probing a server waiting for OAuth", async () => {
    const { memory, probe } = setup({ oauth: "reconnect" });
    expect((await memory.check(actor, "conn-1")).status).toBe("authorization_required");
    expect(probe).not.toHaveBeenCalled();
  });

  it("reports an unreachable server with the connector's sanitized message", async () => {
    const { memory } = setup({
      probe: async () => ({ status: "error", message: "HTTP 503" }),
    });
    expect(await memory.check(actor, "conn-1")).toMatchObject({
      status: "unreachable",
      message: "HTTP 503",
    });
  });

  it("does not expose another person's connection", async () => {
    const { memory } = setup();
    await expect(
      memory.check({ ...actor, userId: "someone-else" }, "conn-1"),
    ).rejects.toBeInstanceOf(IsolationError);
  });

  it("removes the server, which takes the connection and its credential with it", async () => {
    const { memory, servers } = setup();
    await expect(memory.remove(actor, "conn-1")).resolves.toEqual({ ok: true });
    expect(servers.removeMcpServerInTransaction).toHaveBeenCalledWith(expect.anything(), actor, {
      id: server.id,
      secretId: null,
    });
  });
});
