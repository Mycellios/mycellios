import * as z from "zod";
const Key = z.string().min(1).max(160);
const FieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,47}$/);
export const WorkflowAnswerFieldSchema = z.discriminatedUnion("type", [
  z.object({ name: FieldName, type: z.enum(["text", "number", "integer", "boolean", "list"]) }),
  z.object({ name: FieldName, type: z.literal("label"), labels: z.array(z.string().trim().min(1).max(80)).min(1).max(12) }),
]);
export type WorkflowAnswerField = z.infer<typeof WorkflowAnswerFieldSchema>;
const WorkflowValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);
export type WorkflowValue = z.infer<typeof WorkflowValueSchema>;
export type WorkflowValues = Record<string, WorkflowValue>;

export function workflowAnswerSchema(fields: readonly WorkflowAnswerField[]) {
  return z.strictObject(Object.fromEntries(fields.map(field => {
    switch (field.type) {
      case "text": return [field.name, z.string().max(8000)];
      case "number": return [field.name, z.number()];
      case "integer": return [field.name, z.number().int()];
      case "boolean": return [field.name, z.boolean()];
      case "list": return [field.name, z.array(z.string().max(500)).max(40)];
      case "label": return [field.name, z.enum(field.labels)];
    }
  })));
}

export function validateWorkflowAnswer(fields: readonly WorkflowAnswerField[], input: unknown) {
  const result = workflowAnswerSchema(fields).safeParse(input);
  return result.success && JSON.stringify(result.data).length <= 16_000 ? result.data as WorkflowValues : null;
}
export const WorkflowNodeSchema = z.object({
  id: Key,
  kind: z.enum([
    "trigger",
    "prompt",
    "agent",
    "condition",
    "approval",
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
  trigger: z.enum(["manual", "schedule", "webhook"]).optional(),
  answerFields: z.array(WorkflowAnswerFieldSchema).max(12).optional(),
  fieldCondition: z.object({
    field: FieldName,
    operator: z.enum(["eq", "ne", "gt", "gte", "lt", "lte"]),
    value: z.union([z.string().max(500), z.number(), z.boolean()]),
  }).optional(),
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
      .array(z.object({
        id: Key, from: Key, to: Key, branch: z.enum(["yes", "no"]).optional(),
        loop: z.object({ limit: z.number().int().min(1).max(50).default(10) }).optional(),
      }))
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
export const WorkflowVersionSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  createdAt: z.string(),
});
export type WorkflowVersion = z.infer<typeof WorkflowVersionSchema>;
export const WorkflowStepSchema = z.object({
  status: z.enum(["pending", "running", "completed", "failed", "cancelled", "skipped"]),
  runId: Key.optional(),
  output: z.string().max(32_000).optional(),
  error: z.string().optional(),
  fields: z.record(FieldName, WorkflowValueSchema).optional(),
  correction: z.literal(1).optional(),
  loopPasses: z.number().int().min(0).max(50).optional(),
  branch: z.enum(["yes", "no"]).optional(),
  approval: z.object({
    state: z.enum(["waiting", "approved", "rejected"]),
    message: z.string().max(16_000),
  }).optional(),
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
  return ["trigger", "prompt", "agent", "condition", "approval", "output"].includes(node.kind);
}
/** A loop has one entry and exit so resetting it never repeats sibling work. */
export function workflowLoop(graph: WorkflowGraph) {
  const loops = graph.edges.filter(edge => edge.loop);
  if (!loops.length) return undefined;
  if (loops.length !== 1) throw new Error("Use one bounded loop per workflow");
  const edge = loops[0]!;
  const forward = graph.edges.filter(candidate => !candidate.loop);
  const source = graph.nodes.find(node => node.id === edge.from);
  const target = graph.nodes.find(node => node.id === edge.to);
  if (source?.kind !== "condition" || !edge.branch || !target || target.kind === "trigger")
    throw new Error("Connect a Yes or No condition branch back to an earlier step");
  if (forward.some(candidate => candidate.from === edge.from && candidate.branch === edge.branch))
    throw new Error("A repeating branch cannot also leave the loop");
  function connected(start: string, reverse: boolean) {
    const visited = new Set([start]);
    for (const id of visited) {
      for (const candidate of forward) {
        if ((reverse ? candidate.to : candidate.from) === id) visited.add(reverse ? candidate.from : candidate.to);
      }
    }
    return visited;
  }
  const reachable = connected(edge.to, false);
  if (!reachable.has(edge.from)) throw new Error("The loop must go back to an earlier step");
  const nodes = new Set([...connected(edge.from, true)].filter(id => reachable.has(id)));
  for (const candidate of forward) {
    const from = nodes.has(candidate.from), to = nodes.has(candidate.to);
    if ((from && !to && candidate.from !== edge.from) || (!from && to && candidate.to !== edge.to))
      throw new Error("The loop needs one entry and one exit");
  }
  return { edge, nodes };
}

/** Validate executable DAGs, retaining decorative canvas items outside the execution plan. */
export function workflowPlan(graph: WorkflowGraph, triggerId: string): WorkflowNode[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  workflowLoop(graph);
  const forward = graph.edges.filter(edge => !edge.loop);
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
    for (const edge of forward.filter((edge) => edge.from === id)) visit(edge.to);
    active.delete(id);
    visited.add(id);
  };
  visit(triggerId);
  const result: WorkflowNode[] = [],
    left = new Set(visited);
  while (left.size) {
    const ready = [...left].filter((id) =>
      forward
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
  const fields = new Set<string>();
  for (const node of result) {
    if (node.answerFields?.length && node.kind !== "agent") throw new Error("Only an agent step can declare an answer");
    for (const field of node.answerFields ?? []) {
      if (fields.has(field.name)) throw new Error("Workflow answer field names must be unique");
      fields.add(field.name);
    }
    if (node.kind === "condition" && !node.condition && !node.fieldCondition) throw new Error("Choose a condition rule");
    if (node.kind === "approval" && !node.text.trim()) throw new Error("Say what the workflow owner needs to approve");
  }
  return result;
}

export function workflowCondition(node: WorkflowNode, input: string, fields: WorkflowValues = {}): "yes" | "no" {
  const field = node.fieldCondition;
  if (field) {
    if (!Object.hasOwn(fields, field.field)) return "no";
    const actual = fields[field.field];
    if (field.operator === "eq") return actual === field.value ? "yes" : "no";
    if (field.operator === "ne") return actual !== field.value ? "yes" : "no";
    if (typeof actual !== "number" || typeof field.value !== "number") return "no";
    switch (field.operator) {
      case "gt": return actual > field.value ? "yes" : "no";
      case "gte": return actual >= field.value ? "yes" : "no";
      case "lt": return actual < field.value ? "yes" : "no";
      case "lte": return actual <= field.value ? "yes" : "no";
    }
  }
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
