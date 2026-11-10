import type { ConnectorTool } from "@rakazo/adapter-kit";
import { lazyCatalogTools, loadCatalogEntry, searchCatalog } from "./lazy-tool-catalog.js";

export const RUNTIME_TOOL_SEARCH = "__agent_search_tools";
export const RUNTIME_TOOL_LOAD = "__agent_load_tool";
export const RUNTIME_TOOL_GUIDANCE =
  "All authorized tools remain available. If a tool is not currently listed, find it with __agent_search_tools, then activate it with __agent_load_tool before calling it. Loading a tool does not grant permission or execute it.";

/** Everyday tools stay visible without a discovery round trip, like OpenBot's core set. */
const CORE_TOOL_NAMES = new Set([
  "ask_user",
  "remember",
  "list_fleet",
  "read_file",
  "write_file",
  "edit_file",
  "list_files",
  "attach_file",
  "open_path",
  "shell",
  "command_status",
  "work_status",
  "computer_observe",
  "computer_act",
  "request_takeover",
  "web_search",
  "web_fetch",
]);

/** Page schemas, never permissions. Actual calls retain their original executor. */
export class RuntimeToolCatalog {
  private readonly entries;
  private readonly originals = new Map<string, ConnectorTool>();
  readonly controls: ConnectorTool[];
  private active: ConnectorTool[];
  private readonly common: ConnectorTool[];

  constructor(
    private readonly definitions: ConnectorTool[],
    private readonly options: {
      wireName: (tool: ConnectorTool) => string;
      pendingTools: () => Set<ConnectorTool>;
      accept: (definitions: ConnectorTool[]) => void;
    },
  ) {
    for (const tool of definitions) {
      const name = options.wireName(tool);
      if ([RUNTIME_TOOL_SEARCH, RUNTIME_TOOL_LOAD].includes(name) || this.originals.has(name))
        throw new Error("Tool name conflicts with the runtime catalog.");
      this.originals.set(name, tool);
    }
    this.entries = [...this.originals].map(([name, tool]) => ({
      id: name,
      group: "agent",
      tool: { ...tool, name },
    }));
    this.controls = lazyCatalogTools("__agent", "runtime-catalog", "agent", this.entries)
      .slice(0, 2)
      .map((tool) => ({ ...tool, route: undefined }));
    this.controls[0] = {
      ...this.controls[0]!,
      description: `${RUNTIME_TOOL_GUIDANCE}\n${this.controls[0]!.description}`,
    };
    this.controls[1] = {
      ...this.controls[1]!,
      description:
        "Make one authorized tool available for the next call. Use the id from search. This does not execute it.",
    };
    this.common = definitions.filter((tool) => CORE_TOOL_NAMES.has(tool.name));
    this.active = this.withPending(this.common);
  }

  definitionsForModel(): ConnectorTool[] {
    return [...this.active, ...this.controls];
  }
  search(args: Record<string, unknown>) {
    return searchCatalog(this.entries, args);
  }

  load(args: Record<string, unknown>) {
    const entry = loadCatalogEntry(this.entries, args);
    const original = this.originals.get(entry.id);
    if (!original) throw new Error("Tool is not authorized for this agent.");
    const next = this.withPending([...this.common, original]);
    this.options.accept([...next, ...this.controls]);
    this.active = next;
    return { name: entry.id, ready: true };
  }

  private withPending(selected: ConnectorTool[]): ConnectorTool[] {
    const retained = new Set([...selected, ...this.options.pendingTools()]);
    return this.definitions.filter((tool) => retained.has(tool));
  }
}
