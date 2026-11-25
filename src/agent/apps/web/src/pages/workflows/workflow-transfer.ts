import { WorkflowGraphSchema, WorkflowSchema } from "@mycellios/contracts";
import type { Bot, Workflow } from "@mycellios/contracts";

type Draft = Pick<Workflow, "name" | "graph">;
type Mico = Pick<Bot, "id" | "name">;

export function exportWorkflowDraft(draft: Draft, micos: readonly Mico[]) {
  const names = new Map(micos.map(mico => [mico.id, mico.name]));
  const referenced = new Map<string, string>();
  const nodes = draft.graph.nodes.map(({ botId, ...node }) => {
    const name = botId && names.get(botId);
    if (node.kind === "agent" && name) referenced.set(node.id, name);
    return node;
  });
  return {
    format: "mycellios-workflow/1",
    name: draft.name,
    graph: { ...draft.graph, nodes },
    micos: Object.fromEntries(referenced),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function importWorkflowDraft(value: unknown, micos: readonly Mico[]) {
  if (!isRecord(value)) return null;
  const portable = value.format === "mycellios-workflow/1";
  if (!portable && Object.hasOwn(value, "format")) return null;
  const legacy = portable ? null : WorkflowSchema.safeParse(value);
  const name = portable ? value.name : legacy?.success ? legacy.data.name : null;
  const graph = WorkflowGraphSchema.safeParse(portable ? value.graph : legacy?.success ? legacy.data.graph : null);
  if (!graph.success || typeof name !== "string" || !name.trim() || name.length > 160) return null;
  const references = portable && isRecord(value.micos) ? value.micos : {};
  let unassigned = 0;
  const nodes = graph.data.nodes.map(({ botId, ...node }) => {
    if (node.kind !== "agent") return node;
    const name = Object.hasOwn(references, node.id) ? references[node.id] : undefined;
    const matches = portable ? micos.filter(mico => mico.name === name) : micos.filter(mico => mico.id === botId);
    if (matches.length === 1) return { ...node, botId: matches[0]!.id };
    unassigned += 1;
    return node;
  });
  return { name: name.trim(), graph: { ...graph.data, nodes }, unassigned };
}
