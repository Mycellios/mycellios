import * as z from "zod";
const Key = z.string().min(1).max(160);
export const WorkflowNodeSchema = z.object({
  id: Key,
  kind: z.enum([
    "trigger",
    "prompt",
    "agent",
    "condition",
    "output",
    "note",
    "text",
    "shape",
    "drawing",
  ]),
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  title: z.string().max(160).default(""),
  text: z.string().max(16_000).default(""),
  botId: Key.optional(),
  trigger: z.enum(["manual", "schedule"]).optional(),
  cron: z.string().max(100).optional(),
  timezone: z.string().max(80).optional(),
  condition: z
    .object({
      operator: z.enum(["contains", "equals", "nonempty"]),
      value: z.string().max(1000).default(""),
    })
    .optional(),
  points: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
    .max(1000)
    .optional(),
});
export const WorkflowGraphSchema = z
  .object({
    nodes: z.array(WorkflowNodeSchema).max(60),
    edges: z
      .array(z.object({ id: Key, from: Key, to: Key, branch: z.enum(["yes", "no"]).optional() }))
      .max(120),
  })
  .superRefine((graph, ctx) => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (ids.size !== graph.nodes.length)
      ctx.addIssue({ code: "custom", message: "Node IDs must be unique" });
    if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length)
      ctx.addIssue({ code: "custom", message: "Connection IDs must be unique" });
    if (
      graph.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
    )
      ctx.addIssue({ code: "custom", message: "Invalid connection" });
    if (JSON.stringify(graph).length > 256_000)
      ctx.addIssue({ code: "custom", message: "Workflow is too large" });
  });
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export const WorkflowSchema = z.object({
  id: Key,
  name: z.string(),
  version: z.number().int(),
  graph: WorkflowGraphSchema,
  active: z.boolean(),
  nextRunAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
export const WorkflowStepSchema = z.object({
  status: z.enum(["running", "completed", "failed", "cancelled", "skipped"]),
  runId: Key.optional(),
  output: z.string().max(32_000).optional(),
  error: z.string().optional(),
  branch: z.enum(["yes", "no"]).optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export const WorkflowExecutionSchema = z.object({
  id: Key,
  workflowId: Key,
  version: z.number(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  steps: z.record(z.string(), WorkflowStepSchema),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;

export function isWorkflowStep(node: WorkflowNode) {
  return ["trigger", "prompt", "agent", "condition", "output"].includes(node.kind);
}
/** Validate executable DAGs, retaining decorative canvas items outside the execution plan. */
export function workflowPlan(graph: WorkflowGraph, triggerId: string): WorkflowNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodes.get(triggerId)?.kind !== "trigger") throw new Error("Choose a trigger");
  for (const edge of graph.edges) {
    if ((nodes.get(edge.from)?.kind === "condition") !== Boolean(edge.branch))
      throw new Error("Condition connections need a Yes or No branch");
    if (
      !isWorkflowStep(nodes.get(edge.from)!) ||
      !isWorkflowStep(nodes.get(edge.to)!) ||
      nodes.get(edge.to)?.kind === "trigger"
    )
      throw new Error("Only execution steps can be connected");
  }
  const visited = new Set<string>(),
    active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error("Workflow connections cannot form a cycle");
    if (visited.has(id)) return;
    active.add(id);
    for (const edge of graph.edges.filter((edge) => edge.from === id)) visit(edge.to);
    active.delete(id);
    visited.add(id);
  };
  visit(triggerId);
  const result: WorkflowNode[] = [],
    left = new Set(visited);
  while (left.size) {
    const ready = [...left].filter((id) =>
      graph.edges
        .filter((edge) => edge.to === id)
        .every((edge) => visited.has(edge.from) && !left.has(edge.from)),
    );
    if (!ready.length) throw new Error("A step depends on another trigger or an unreachable node");
    for (const id of ready) {
      result.push(nodes.get(id)!);
      left.delete(id);
    }
  }
  if (!result.some((node) => node.kind === "agent"))
    throw new Error("Connect at least one agent step");
  for (const node of result)
    if (node.kind === "agent" && !node.botId)
      throw new Error("Choose an agent for every agent step");
  for (const node of result)
    if (node.kind === "condition" && !node.condition) throw new Error("Choose a condition rule");
  return result;
}

export function workflowCondition(node: WorkflowNode, input: string): "yes" | "no" {
  const rule = node.condition;
  if (!rule) throw new Error("Choose a condition rule");
  return (
    rule.operator === "nonempty"
      ? Boolean(input.trim())
      : rule.operator === "equals"
        ? input === rule.value
        : input.includes(rule.value)
  )
    ? "yes"
    : "no";
}
