import { describe, expect, it } from "vitest";
import {
  evaluateMemoryProfile,
  MemoryConnectionCreateInput,
  MemoryToolMappingSchema,
  parseStoredMemoryCapabilities,
  parseStoredMemoryToolMapping,
} from "./memory-mcp.js";

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
