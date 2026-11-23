import * as z from "zod";
import { McpRemoteEndpointSchema } from "./mcp.js";

/**
 * Memory MCP profile v1 (specs/mcp-memory/spec.md). A remote MCP server is a memory
 * server when it exposes these tools. The profile is product-neutral: Mycellios never
 * names a particular memory service; any server that implements it can be connected.
 */
export const MEMORY_MCP_PROFILE_VERSION = 1;

export const MEMORY_PROFILE_TOOLS = [
  "memory_search",
  "memory_read",
  "memory_write",
  "memory_forget",
  "memory_status",
] as const;
export type MemoryProfileTool = (typeof MEMORY_PROFILE_TOOLS)[number];

const REQUIRED_TOOLS: readonly MemoryProfileTool[] = ["memory_search", "memory_read"];
const READ_ONLY_TOOLS: readonly MemoryProfileTool[] = [
  "memory_search",
  "memory_read",
  "memory_status",
];

/** Input properties each profile tool must declare; other properties are allowed. */
const REQUIRED_INPUTS: Record<MemoryProfileTool, readonly string[]> = {
  memory_search: ["query"],
  memory_read: ["id"],
  memory_write: ["title", "content"],
  memory_forget: ["id"],
  memory_status: [],
};

const McpToolName = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Tool names use letters, digits, _ . : or -");

/**
 * Optional per-connection mapping from profile tools to differently named tools with the
 * same semantics, for servers that predate the profile. Generic data, never a vendor table.
 */
export const MemoryToolMappingSchema = z
  .object({
    memory_search: McpToolName.optional(),
    memory_read: McpToolName.optional(),
    memory_write: McpToolName.optional(),
    memory_forget: McpToolName.optional(),
    memory_status: McpToolName.optional(),
  })
  .strict()
  .superRefine((mapping, ctx) => {
    const names = Object.values(mapping).filter((name): name is string => Boolean(name));
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: "custom", message: "Each profile tool needs a different server tool" });
    }
  });
export type MemoryToolMapping = z.infer<typeof MemoryToolMappingSchema>;

export const MemoryCapabilitiesSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  forget: z.boolean(),
  projects: z.boolean(),
  status: z.boolean(),
});
export type MemoryCapabilities = z.infer<typeof MemoryCapabilitiesSchema>;

export const NO_MEMORY_CAPABILITIES: MemoryCapabilities = {
  read: false,
  write: false,
  forget: false,
  projects: false,
  status: false,
};

/** The parts of an MCP `tools/list` entry the profile reads. */
export interface McpToolDescription {
  name: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: unknown; destructiveHint?: unknown } | null;
}

export type MemoryProfileEvaluation =
  | {
      compatible: true;
      capabilities: MemoryCapabilities;
      /** Server tool name serving each available profile tool. */
      tools: Partial<Record<MemoryProfileTool, string>>;
      warnings: string[];
    }
  | { compatible: false; problems: string[] };

function declaredProperties(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function propertyAcceptsString(property: unknown): boolean {
  if (!property || typeof property !== "object") return true;
  const type = (property as { type?: unknown }).type;
  if (type === undefined) return true;
  return type === "string" || (Array.isArray(type) && type.includes("string"));
}

/**
 * Decide whether a server's tools implement the memory profile. A required tool that is
 * missing, lacks a required input, or declares itself not read-only (it would be called
 * automatically every turn) makes the server incompatible. Optional tools with problems
 * are left out and reported as warnings.
 */
export function evaluateMemoryProfile(
  serverTools: readonly McpToolDescription[],
  mapping: MemoryToolMapping = {},
): MemoryProfileEvaluation {
  const byName = new Map(serverTools.map((tool) => [tool.name, tool]));
  const problems: string[] = [];
  const warnings: string[] = [];
  const tools: Partial<Record<MemoryProfileTool, string>> = {};
  for (const profileTool of MEMORY_PROFILE_TOOLS) {
    const serverName = mapping[profileTool] ?? profileTool;
    const required = REQUIRED_TOOLS.includes(profileTool);
    const report = (message: string) => (required ? problems : warnings).push(message);
    const tool = byName.get(serverName);
    if (!tool) {
      if (required) problems.push(`Missing the required tool ${serverName}.`);
      continue;
    }
    const properties = declaredProperties(tool.inputSchema);
    const missingInputs = REQUIRED_INPUTS[profileTool].filter(
      (input) => !(input in properties) || !propertyAcceptsString(properties[input]),
    );
    if (missingInputs.length > 0) {
      report(`${serverName} does not accept ${missingInputs.join(", ")} as text.`);
      continue;
    }
    if (READ_ONLY_TOOLS.includes(profileTool)) {
      if (tool.annotations?.readOnlyHint === false) {
        report(`${serverName} declares that it changes data, so it cannot be used for reading.`);
        continue;
      }
      if (tool.annotations?.readOnlyHint !== true) {
        warnings.push(`${serverName} does not declare itself read-only.`);
      }
    }
    tools[profileTool] = serverName;
  }
  if (problems.length > 0) return { compatible: false, problems };
  const searchProperties = declaredProperties(byName.get(tools.memory_search ?? "")?.inputSchema);
  return {
    compatible: true,
    tools,
    warnings,
    capabilities: {
      read: true,
      write: Boolean(tools.memory_write),
      // Forgetting is only offered alongside writing (spec: forget requires read_write).
      forget: Boolean(tools.memory_write && tools.memory_forget),
      projects: "projectId" in searchProperties,
      status: Boolean(tools.memory_status),
    },
  };
}

export const MemoryConnectionStatusSchema = z.enum([
  /** Saved but not checked yet. */
  "unchecked",
  /** The account must be authorized (OAuth) before it can be checked. */
  "authorization_required",
  "compatible",
  "incompatible",
  "unreachable",
]);
export type MemoryConnectionStatus = z.infer<typeof MemoryConnectionStatusSchema>;

export const MemoryConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpoint: z.string(),
  /** The personal MCP server row that carries transport and OAuth state. */
  serverId: z.string(),
  oauthStatus: z.enum(["none", "connected", "reconnect"]),
  status: MemoryConnectionStatusSchema,
  /** Human-readable result of the last check; never contains credentials. */
  message: z.string().nullable(),
  capabilities: MemoryCapabilitiesSchema,
  toolMapping: MemoryToolMappingSchema,
  checkedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MemoryConnection = z.infer<typeof MemoryConnectionSchema>;

export const MemoryConnectionCreateInput = z.object({
  name: z.string().trim().min(1).max(80),
  endpoint: McpRemoteEndpointSchema,
  /** Only for servers without OAuth; sent as `Authorization: Bearer <token>`. */
  token: z.string().min(8).max(4096).optional(),
  toolMapping: MemoryToolMappingSchema.default({}),
});
export type MemoryConnectionCreateInput = z.infer<typeof MemoryConnectionCreateInput>;

/** Parse stored JSON, falling back to an empty mapping for rows written by other versions. */
export function parseStoredMemoryToolMapping(value: unknown): MemoryToolMapping {
  const parsed = MemoryToolMappingSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

export function parseStoredMemoryCapabilities(value: unknown): MemoryCapabilities {
  const parsed = MemoryCapabilitiesSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_MEMORY_CAPABILITIES;
}

/** What a Mico may do with one personal memory. Writing needs the server's write capability. */
export const MicoMemoryAccessSchema = z.enum(["read", "read_write"]);
export type MicoMemoryAccess = z.infer<typeof MicoMemoryAccessSchema>;

/**
 * A Mico's access to one personal memory (specs/mcp-memory). Nothing is granted by default;
 * only the connection's owner grants it, through the authenticated API.
 */
export const MicoMemoryGrantSchema = z.object({
  id: z.string(),
  botId: z.string(),
  connectionId: z.string(),
  access: MicoMemoryAccessSchema,
  /** May forget entries; only with read_write and a server that can forget. */
  allowForget: z.boolean(),
  /** Search this memory automatically before each reply. */
  autoRecall: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MicoMemoryGrant = z.infer<typeof MicoMemoryGrantSchema>;

export const MemoryGrantsSetInput = z.object({
  connectionId: z.string().min(1).max(128),
  /** The complete set of Micos that may use this memory; omitted Micos lose access. */
  grants: z
    .array(
      z.object({
        botId: z.string().min(1).max(128),
        autoRecall: z.boolean().default(true),
        access: MicoMemoryAccessSchema.default("read"),
        allowForget: z.boolean().default(false),
      }),
    )
    .max(200)
    .superRefine((grants, ctx) => {
      const ids = grants.map((grant) => grant.botId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "Each Mico can appear only once" });
      }
      if (grants.some((grant) => grant.allowForget && grant.access !== "read_write")) {
        ctx.addIssue({ code: "custom", message: "Forgetting needs write access" });
      }
    }),
});
export type MemoryGrantsSetInput = z.infer<typeof MemoryGrantsSetInput>;

/** The most results one memory search asks a server for. */
export const MEMORY_SEARCH_LIMIT_MAX = 10;
const SNIPPET_MAX_CHARS = 1_000;

export interface MemorySearchHit {
  id: string;
  title?: string;
  snippet: string;
  score?: number;
  updatedAt?: string;
  projectId?: string;
}

/** The JSON a profile tool returned, from `structuredContent` or its first JSON text part. */
export function memoryToolPayload(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const row = result as { structuredContent?: unknown; content?: unknown };
  if (row.structuredContent && typeof row.structuredContent === "object") {
    return row.structuredContent;
  }
  if (!Array.isArray(row.content)) return undefined;
  for (const part of row.content) {
    if (!part || typeof part !== "object") continue;
    const { type, text } = part as { type?: unknown; text?: unknown };
    if (type !== "text" || typeof text !== "string") continue;
    try {
      return JSON.parse(text);
    } catch {
      // Not JSON: try the next text part.
    }
  }
  return undefined;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Parse a `memory_search` result. Hits without an id or text are dropped, text is bounded,
 * and at most `limit` hits are kept, so a server cannot flood the model's context.
 */
export function parseMemorySearchResults(payload: unknown, limit: number): MemorySearchHit[] {
  const results =
    payload && typeof payload === "object" ? (payload as { results?: unknown }).results : undefined;
  if (!Array.isArray(results)) return [];
  const hits: MemorySearchHit[] = [];
  for (const item of results) {
    if (hits.length >= limit) break;
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = boundedText(typeof row.id === "number" ? String(row.id) : row.id, 200);
    const snippet =
      boundedText(row.snippet, SNIPPET_MAX_CHARS) ?? boundedText(row.content, SNIPPET_MAX_CHARS);
    if (!id || !snippet) continue;
    const title = boundedText(row.title, 200);
    const updatedAt = boundedText(row.updatedAt, 64);
    const projectId = boundedText(row.projectId, 200);
    hits.push({
      id,
      snippet,
      ...(title ? { title } : {}),
      ...(typeof row.score === "number" && Number.isFinite(row.score) ? { score: row.score } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(projectId ? { projectId } : {}),
    });
  }
  return hits;
}

/** Largest memory_write content, in UTF-8 bytes (Memory MCP profile v1). */
export const MEMORY_WRITE_CONTENT_MAX_BYTES = 8_000;
export const MEMORY_WRITE_TITLE_MAX_CHARS = 200;

export interface MemoryWriteResult {
  id: string;
  status: "created" | "updated" | "unchanged";
}

/** Parse a memory_write result; null when the server did not confirm the write. */
export function parseMemoryWriteResult(payload: unknown): MemoryWriteResult | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const id = boundedText(typeof row.id === "number" ? String(row.id) : row.id, 200);
  const status = row.status;
  if (!id || (status !== "created" && status !== "updated" && status !== "unchanged")) return null;
  return { id, status };
}

/** Parse a memory_forget result; null when the server did not answer in the profile shape. */
export function parseMemoryForgetResult(
  payload: unknown,
): { id: string; forgotten: boolean } | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const id = boundedText(typeof row.id === "number" ? String(row.id) : row.id, 200);
  if (!id || typeof row.forgotten !== "boolean") return null;
  return { id, forgotten: row.forgotten };
}
