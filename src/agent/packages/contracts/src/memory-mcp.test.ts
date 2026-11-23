import { describe, expect, it } from "vitest";
import {
  evaluateMemoryProfile,
  MemoryConnectionCreateInput,
  MemoryGrantsSetInput,
  MemoryToolMappingSchema,
  memoryToolPayload,
  parseMemoryForgetResult,
  parseMemorySearchResults,
  parseMemoryWriteResult,
  parseStoredMemoryCapabilities,
  parseStoredMemoryToolMapping,
} from "./memory-mcp.js";

describe("memory search results", () => {
  it("reads structuredContent first, then the first JSON text part", () => {
    expect(memoryToolPayload({ structuredContent: { results: [] } })).toEqual({ results: [] });
    expect(
      memoryToolPayload({
        content: [
          { type: "text", text: "not json" },
          { type: "text", text: '{"results":[{"id":"1"}]}' },
        ],
      }),
    ).toEqual({ results: [{ id: "1" }] });
    expect(memoryToolPayload({ content: [{ type: "image" }] })).toBeUndefined();
  });

  it("keeps valid hits, bounds their text and respects the limit", () => {
    const hits = parseMemorySearchResults(
      {
        results: [
          { id: 7, content: "from content", score: 0.5 },
          { id: "2", snippet: "y".repeat(5_000), title: "Long" },
          { id: "3" },
          { snippet: "missing id" },
          { id: "4", snippet: "over the limit" },
        ],
      },
      2,
    );
    expect(hits.map((hit) => hit.id)).toEqual(["7", "2"]);
    expect(hits[0]).toEqual({ id: "7", snippet: "from content", score: 0.5 });
    expect(hits[1]!.snippet.length).toBeLessThanOrEqual(1_000);
  });

  it("returns nothing for an unexpected payload", () => {
    expect(parseMemorySearchResults(undefined, 5)).toEqual([]);
    expect(parseMemorySearchResults({ results: "no" }, 5)).toEqual([]);
  });
});

describe("memory grants input", () => {
  it("rejects the same Mico twice", () => {
    expect(
      MemoryGrantsSetInput.safeParse({
        connectionId: "c",
        grants: [{ botId: "b" }, { botId: "b" }],
      }).success,
    ).toBe(false);
  });

  it("defaults to reading with automatic recall", () => {
    expect(
      MemoryGrantsSetInput.parse({ connectionId: "c", grants: [{ botId: "b" }] }).grants[0],
    ).toEqual({ botId: "b", autoRecall: true, access: "read", allowForget: false });
  });

  it("allows forgetting only with write access", () => {
    const parse = (grant: object) =>
      MemoryGrantsSetInput.safeParse({ connectionId: "c", grants: [{ botId: "b", ...grant }] })
        .success;
    expect(parse({ access: "read", allowForget: true })).toBe(false);
    expect(parse({ access: "read_write", allowForget: true })).toBe(true);
  });
});

describe("memory write and forget results", () => {
  it("accepts only a confirmed write status", () => {
    expect(parseMemoryWriteResult({ id: "e1", status: "updated" })).toEqual({
      id: "e1",
      status: "updated",
    });
    expect(parseMemoryWriteResult({ id: "e1", status: "queued" })).toBeNull();
    expect(parseMemoryWriteResult({ status: "created" })).toBeNull();
  });

  it("needs an id and a forgotten flag", () => {
    expect(parseMemoryForgetResult({ id: "e1", forgotten: true })).toEqual({
      id: "e1",
      forgotten: true,
    });
    expect(parseMemoryForgetResult({ id: "e1" })).toBeNull();
  });
});

const readOnly = { readOnlyHint: true };
const tool = (name: string, properties: Record<string, unknown>, annotations?: object) => ({
  name,
  inputSchema: { type: "object", properties },
  ...(annotations ? { annotations } : {}),
});

const search = tool(
  "memory_search",
  { query: { type: "string" }, limit: { type: "integer" } },
  readOnly,
);
const read = tool("memory_read", { id: { type: "string" } }, readOnly);

describe("evaluateMemoryProfile", () => {
  it("accepts a read-only server with the two required tools", () => {
    expect(evaluateMemoryProfile([search, read])).toEqual({
      compatible: true,
      tools: { memory_search: "memory_search", memory_read: "memory_read" },
      warnings: [],
      capabilities: { read: true, write: false, forget: false, projects: false, status: false },
    });
  });

  it("reports every missing required tool", () => {
    const result = evaluateMemoryProfile([tool("something_else", {})]);
    expect(result.compatible).toBe(false);
    if (!result.compatible) {
      expect(result.problems).toEqual([
        "Missing the required tool memory_search.",
        "Missing the required tool memory_read.",
      ]);
    }
  });

  it("refuses a search tool that declares it changes data", () => {
    const result = evaluateMemoryProfile([
      tool("memory_search", { query: { type: "string" } }, { readOnlyHint: false }),
      read,
    ]);
    expect(result.compatible).toBe(false);
  });

  it("refuses a required tool without its required text input", () => {
    const result = evaluateMemoryProfile([
      tool("memory_search", { query: { type: "number" } }, readOnly),
      read,
    ]);
    expect(result.compatible).toBe(false);
  });

  it("warns, but accepts, read tools that do not declare themselves read-only", () => {
    const result = evaluateMemoryProfile([
      tool("memory_search", { query: { type: "string" } }),
      read,
    ]);
    expect(result).toMatchObject({
      compatible: true,
      warnings: ["memory_search does not declare itself read-only."],
    });
  });

  it("detects write, forget, projects and status capabilities", () => {
    const result = evaluateMemoryProfile([
      tool("memory_search", { query: { type: "string" }, projectId: { type: "string" } }, readOnly),
      read,
      tool("memory_write", { title: { type: "string" }, content: { type: "string" } }),
      tool("memory_forget", { id: { type: "string" } }, { destructiveHint: true }),
      tool("memory_status", {}, readOnly),
    ]);
    expect(result).toMatchObject({
      compatible: true,
      capabilities: { read: true, write: true, forget: true, projects: true, status: true },
    });
  });

  it("never offers forget without write", () => {
    const result = evaluateMemoryProfile([
      search,
      read,
      tool("memory_forget", { id: { type: "string" } }),
    ]);
    expect(result).toMatchObject({ compatible: true, capabilities: { forget: false } });
  });

  it("drops an optional tool with the wrong shape and keeps the server compatible", () => {
    const result = evaluateMemoryProfile([search, read, tool("memory_write", { title: {} })]);
    expect(result).toMatchObject({
      compatible: true,
      capabilities: { write: false },
      warnings: ["memory_write does not accept content as text."],
    });
  });

  it("follows a generic tool mapping for servers with other names", () => {
    const result = evaluateMemoryProfile(
      [
        tool("find", { query: { type: "string" } }, readOnly),
        tool("get", { id: { type: "string" } }, readOnly),
      ],
      { memory_search: "find", memory_read: "get" },
    );
    expect(result).toMatchObject({
      compatible: true,
      tools: { memory_search: "find", memory_read: "get" },
    });
  });
});

describe("memory connection inputs", () => {
  it("rejects a mapping that sends two profile tools to one server tool", () => {
    expect(
      MemoryToolMappingSchema.safeParse({ memory_search: "find", memory_read: "find" }).success,
    ).toBe(false);
  });

  it("rejects unknown mapping keys", () => {
    expect(MemoryToolMappingSchema.safeParse({ recall: "find" }).success).toBe(false);
  });

  it("requires an HTTP(S) endpoint without credentials", () => {
    const base = { name: "My memory", toolMapping: {} };
    expect(
      MemoryConnectionCreateInput.safeParse({ ...base, endpoint: "https://memory.example/mcp" })
        .success,
    ).toBe(true);
    expect(
      MemoryConnectionCreateInput.safeParse({ ...base, endpoint: "https://u:p@memory.example/mcp" })
        .success,
    ).toBe(false);
  });

  it("reads stored JSON from other versions safely", () => {
    expect(parseStoredMemoryToolMapping({ unknown: "x" })).toEqual({});
    expect(parseStoredMemoryCapabilities(null)).toEqual({
      read: false,
      write: false,
      forget: false,
      projects: false,
      status: false,
    });
  });
});
