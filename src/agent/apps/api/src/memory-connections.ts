import { randomBytes } from "node:crypto";
import type { McpOAuthBroker, McpOAuthSummary } from "@mycellios/adapters";
import type {
  Actor,
  MemoryConnection,
  MemoryConnectionCreateInput,
  MemoryConnectionStatus,
} from "@mycellios/contracts";
import {
  evaluateMemoryProfile,
  NO_MEMORY_CAPABILITIES,
  parseStoredMemoryCapabilities,
  parseStoredMemoryToolMapping,
} from "@mycellios/contracts";
import type { McpServer as McpServerRow, Prisma } from "@mycellios/db";
import { IsolationError } from "@mycellios/db";
import { ORPCError } from "@orpc/server";
import type { createMcpServers } from "./mcp-servers.js";
import type { RouterDeps } from "./router.js";

type McpServers = Pick<
  ReturnType<typeof createMcpServers>,
  "prepareMcpServer" | "insertMcpServer" | "removeMcpServerInTransaction" | "mcpAwaitsOAuth"
>;

/** At most this many personal memory servers per person and Space. */
export const MAX_MEMORY_CONNECTIONS = 10;

const MESSAGE_MAX = 500;

type ConnectionRow = {
  id: string;
  serverId: string;
  toolMapping: unknown;
  status: string;
  message: string | null;
  capabilities: unknown;
  checkedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const STATUSES: readonly MemoryConnectionStatus[] = [
  "unchecked",
  "authorization_required",
  "compatible",
  "incompatible",
  "unreachable",
];

export function memoryConnectionDto(
  row: ConnectionRow,
  server: Pick<McpServerRow, "name" | "endpoint">,
  oauth: McpOAuthSummary,
): MemoryConnection {
  const status = STATUSES.includes(row.status as MemoryConnectionStatus)
    ? (row.status as MemoryConnectionStatus)
    : "unchecked";
  return {
    id: row.id,
    name: server.name,
    endpoint: server.endpoint ?? "",
    serverId: row.serverId,
    oauthStatus: oauth.status,
    status,
    message: row.message,
    capabilities:
      status === "compatible"
        ? parseStoredMemoryCapabilities(row.capabilities)
        : NO_MEMORY_CAPABILITIES,
    toolMapping: parseStoredMemoryToolMapping(row.toolMapping),
    checkedAt: row.checkedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function bounded(message: string): string {
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message;
}

/**
 * Personal memory connections (specs/mcp-memory, phase 1). Each one is a remote MCP server
 * owned by the person, reusing the existing MCP transport, OAuth broker and SSRF checks.
 * Nothing here is specific to a memory product: compatibility is decided only by the open
 * Memory MCP profile. Connections grant no Mico access by themselves.
 */
export function createMemoryConnections(
  deps: Pick<RouterDeps, "prisma" | "mcp">,
  mcpOAuth: Pick<McpOAuthBroker, "summaryFor">,
  servers: McpServers,
) {
  const owned = (actor: Actor) => ({ spaceId: actor.spaceId, userId: actor.userId });

  const load = async (actor: Actor, id: string) => {
    const row = await deps.prisma.memoryConnection.findFirst({
      where: { id, ...owned(actor) },
      include: { server: true },
    });
    if (!row) throw new IsolationError();
    return row;
  };

  const dto = async (row: ConnectionRow & { server: McpServerRow }, actor: Actor) =>
    memoryConnectionDto(row, row.server, await mcpOAuth.summaryFor(row.server, actor));

  const list = async (actor: Actor): Promise<MemoryConnection[]> => {
    const rows = await deps.prisma.memoryConnection.findMany({
      where: owned(actor),
      include: { server: true },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(rows.map((row) => dto(row, actor)));
  };

  const create = async (
    actor: Actor,
    input: MemoryConnectionCreateInput,
  ): Promise<MemoryConnection> => {
    const existing = await deps.prisma.memoryConnection.count({ where: owned(actor) });
    if (existing >= MAX_MEMORY_CONNECTIONS) {
      throw new ORPCError("BAD_REQUEST", {
        message: `At most ${MAX_MEMORY_CONNECTIONS} memory connections are allowed`,
      });
    }
    const config = {
      transport: "streamable_http" as const,
      slug: `memory-${randomBytes(6).toString("hex")}`,
      name: input.name,
      description: "",
      enabled: true,
      endpoint: input.endpoint,
      headers: {},
      ...(input.token ? { secret: input.token } : {}),
      oauthClient: null,
    };
    // Same endpoint validation (HTTPS, SSRF, private-endpoint authorization) as any MCP server.
    const stored = await servers.prepareMcpServer(actor, config);
    const row = await deps.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const server = await servers.insertMcpServer(tx, actor, config, stored);
      const connection = await tx.memoryConnection.create({
        data: {
          ...owned(actor),
          serverId: server.id,
          toolMapping: input.toolMapping as Prisma.InputJsonValue,
        },
      });
      return { ...connection, server };
    });
    return dto(row, actor);
  };

  const record = async (
    id: string,
    status: MemoryConnectionStatus,
    message: string | null,
    capabilities: Prisma.InputJsonValue = {},
  ) =>
    deps.prisma.memoryConnection.update({
      where: { id },
      data: {
        status,
        message: message === null ? null : bounded(message),
        capabilities,
        checkedAt: new Date(),
      },
    });

  const check = async (actor: Actor, id: string): Promise<MemoryConnection> => {
    const row = await load(actor, id);
    const oauth = await mcpOAuth.summaryFor(row.server, actor);
    if (!deps.mcp) {
      await record(row.id, "unreachable", "This server cannot be checked from here.");
    } else if (
      oauth.status === "reconnect" ||
      (await servers.mcpAwaitsOAuth(row.server, actor, oauth))
    ) {
      await record(row.id, "authorization_required", "Authorize this memory to check it.");
    } else {
      const result = await deps.mcp
        .probe(row.server, owned(actor))
        .catch(() => ({ status: "error" as const, message: "Could not reach this server." }));
      if (result.status !== "ok" || !("tools" in result) || !result.tools) {
        await record(
          row.id,
          "unreachable",
          ("message" in result && result.message) || "Could not reach this server.",
        );
      } else {
        const evaluation = evaluateMemoryProfile(
          result.tools,
          parseStoredMemoryToolMapping(row.toolMapping),
        );
        if (evaluation.compatible) {
          await record(
            row.id,
            "compatible",
            evaluation.warnings.length > 0 ? evaluation.warnings.join(" ") : null,
            evaluation.capabilities,
          );
        } else {
          await record(row.id, "incompatible", evaluation.problems.join(" "));
        }
      }
    }
    return dto(await load(actor, id), actor);
  };

  const remove = async (actor: Actor, id: string) => {
    const row = await load(actor, id);
    // Deleting the server cascades to the connection; its credential goes with it.
    await deps.prisma.$transaction((tx: Prisma.TransactionClient) =>
      servers.removeMcpServerInTransaction(tx, actor, {
        id: row.server.id,
        secretId: row.server.secretId,
      }),
    );
    return { ok: true as const };
  };

  return { list, create, check, remove };
}
