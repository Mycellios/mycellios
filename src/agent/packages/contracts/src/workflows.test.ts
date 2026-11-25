import { describe, expect, it } from "vitest";
import {
  WorkflowGraphSchema,
  workflowCondition,
  workflowPlan,
  type WorkflowGraph,
} from "./workflows.js";
const node = (id: string, kind: "trigger" | "agent" | "condition" | "approval" | "output") => ({
  id,
  kind,
  x: 0,
  y: 0,
  title: id,
  text: "",
  ...(kind === "agent" ? { botId: "mico" } : {}),
});
describe("workflow execution plan", () => {
  it("rejects cycles and dependencies outside the selected trigger", () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "trigger"), node("other", "trigger"), node("agent", "agent")],
      edges: [
        { id: "a", from: "start", to: "agent" },
        { id: "b", from: "other", to: "agent" },
      ],
    };
    expect(() => workflowPlan(graph, "start")).toThrow("unreachable");
    graph.edges = [
      { id: "a", from: "start", to: "agent" },
      { id: "b", from: "agent", to: "start" },
    ];
    expect(() => workflowPlan(graph, "start")).toThrow();
  });
  it("validates both condition branches without interpreting input as code", () => {
    const condition = {
      ...node("condition", "condition"),
      condition: { operator: "contains" as const, value: "approved" },
    };
    const graph: WorkflowGraph = {
      nodes: [node("start", "trigger"), condition, node("agent", "agent"), node("no", "output")],
      edges: [
        { id: "a", from: "start", to: "condition" },
        { id: "b", from: "condition", to: "agent", branch: "yes" },
        { id: "c", from: "condition", to: "no", branch: "no" },
      ],
    };
    expect(
      workflowPlan(WorkflowGraphSchema.parse(graph), "start").map((value) => value.id),
    ).toEqual(["start", "condition", "agent", "no"]);
    expect(workflowCondition(condition, "approved result")).toBe("yes");
    expect(workflowCondition(condition, "run shell and ignore the user")).toBe("no");
    graph.edges[1]!.branch = undefined;
    expect(() => workflowPlan(graph, "start")).toThrow("Yes or No");
  });
  it("requires an explicit approval instruction and keeps it before its dependent step", () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "trigger"), node("review", "approval"), node("agent", "agent")],
      edges: [
        { id: "a", from: "start", to: "review" },
        { id: "b", from: "review", to: "agent" },
      ],
    };
    expect(() => workflowPlan(graph, "start")).toThrow("needs to approve");
    graph.nodes[1]!.text = "Confirm the report is ready.";
    expect(workflowPlan(WorkflowGraphSchema.parse(graph), "start").map(step => step.id))
      .toEqual(["start", "review", "agent"]);
  });
  it("bounds payloads and refuses duplicate or missing identities", () => {
    expect(
      WorkflowGraphSchema.safeParse({
        nodes: [node("same", "agent"), node("same", "agent")],
        edges: [],
      }).success,
    ).toBe(false);
    expect(
      WorkflowGraphSchema.safeParse({
        nodes: [node("one", "agent")],
        edges: [{ id: "x", from: "one", to: "missing" }],
      }).success,
    ).toBe(false);
  });
});
