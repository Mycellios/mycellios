import type { ConnectorTool } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import {
  RUNTIME_TOOL_LOAD,
  RUNTIME_TOOL_SEARCH,
  RuntimeToolCatalog,
} from "./runtime-tool-catalog.js";

const definition = (name: string): ConnectorTool => ({
  name,
  description: name,
  inputSchema: { type: "object", properties: {} },
});

describe("runtime schema catalog", () => {
  it("declares authorized memory and clarification schemas immediately and retains them while paging", () => {
    const memory = definition("remember");
    const clarification = definition("ask_user");
    const other = definition("read_file");
    const catalog = new RuntimeToolCatalog([memory, clarification, other], {
      wireName: (tool) => tool.name,
      pendingTools: () => new Set(),
      accept: () => undefined,
    });
    expect(catalog.definitionsForModel()).toContain(memory);
    expect(catalog.definitionsForModel()).toContain(clarification);
    expect(catalog.definitionsForModel()).not.toContain(other);
    catalog.load({ id: "read_file" });
    expect(catalog.definitionsForModel()).toContain(memory);
    expect(catalog.definitionsForModel()).toContain(clarification);
    expect(catalog.definitionsForModel()).toContain(other);
  });

  it("keeps every authorized tool discoverable and activates the exact original definition", () => {
    const tools = [definition("list_fleet"), definition("write_file"), definition("run_subagent")];
    const accept = vi.fn();
    const catalog = new RuntimeToolCatalog(tools, {
      wireName: (tool) => tool.name,
      pendingTools: () => new Set(),
      accept,
    });
    expect(catalog.definitionsForModel().map((tool) => tool.name)).toEqual([
      "list_fleet",
      RUNTIME_TOOL_SEARCH,
      RUNTIME_TOOL_LOAD,
    ]);
    const result = catalog.search({ query: "run_subagent" });
    expect(result).toMatchObject({ tools: [{ id: "run_subagent" }] });
    expect(catalog.load({ id: "run_subagent" })).toEqual({ name: "run_subagent", ready: true });
    expect(catalog.definitionsForModel()).toContain(tools[2]);
    expect(accept).toHaveBeenCalledOnce();
  });

  it("retains in-flight tool definitions and pages out only resolved schemas", () => {
    const tools = [definition("list_fleet"), definition("read_file"), definition("write_file")];
    const pending = new Set<ConnectorTool>([tools[1]!]);
    const catalog = new RuntimeToolCatalog(tools, {
      wireName: (tool) => tool.name,
      pendingTools: () => pending,
      accept: () => undefined,
    });
    catalog.load({ id: "write_file" });
    expect(catalog.definitionsForModel()).toContain(tools[1]);
    expect(catalog.definitionsForModel()).toContain(tools[2]);
    pending.clear();
    catalog.load({ id: "read_file" });
    expect(catalog.definitionsForModel()).not.toContain(tools[2]);
    expect(catalog.search({ query: "write_file" })).toMatchObject({
      tools: [{ id: "write_file" }],
    });
  });

  it("cannot activate a tool absent from this agent, including excluded delegation tools", () => {
    const catalog = new RuntimeToolCatalog([definition("read_file")], {
      wireName: (tool) => tool.name,
      pendingTools: () => new Set(),
      accept: () => undefined,
    });
    expect(() => catalog.load({ id: "run_subagent" })).toThrow("not authorized");
    expect(catalog.search({ query: "run_subagent" })).toMatchObject({ tools: [] });
  });

  it("preserves normalized wire identities and does not execute while loading", () => {
    const original = definition("connector:name");
    const catalog = new RuntimeToolCatalog([original], {
      wireName: () => "connector_name_stable",
      pendingTools: () => new Set(),
      accept: () => undefined,
    });
    expect(catalog.load({ id: "connector_name_stable" })).toEqual({
      name: "connector_name_stable",
      ready: true,
    });
    expect(catalog.definitionsForModel()).toContain(original);
    expect(original.name).toBe("connector:name");
    expect(catalog.controls.every((tool) => tool.readOnly && !tool.route)).toBe(true);
  });

  it("does not change state after a schema budget rejection or name collision", () => {
    const catalog = new RuntimeToolCatalog([definition("write_file")], {
      wireName: (tool) => tool.name,
      pendingTools: () => new Set(),
      accept: () => {
        throw new Error("too large");
      },
    });
    expect(() => catalog.load({ id: "write_file" })).toThrow("too large");
    expect(catalog.definitionsForModel().some((tool) => tool.name === "write_file")).toBe(false);
    expect(
      () =>
        new RuntimeToolCatalog([definition(RUNTIME_TOOL_LOAD)], {
          wireName: (tool) => tool.name,
          pendingTools: () => new Set(),
          accept: () => undefined,
        }),
    ).toThrow("conflicts");
  });
});
