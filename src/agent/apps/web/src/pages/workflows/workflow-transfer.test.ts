import { describe, expect, it } from "vitest";
import type { Workflow } from "@mycellios/contracts";
import { exportWorkflowDraft, importWorkflowDraft } from "./workflow-transfer";

const workflow = {
  name: "Follow up",
  graph: {
    nodes: [{ id: "agent", kind: "agent", x: 0, y: 0, title: "", text: "", botId: "original-mico" }],
    edges: [],
  },
} satisfies Pick<Workflow, "name" | "graph">;

describe("workflow transfer", () => {
  it("leaves account identifiers out of the file and matches a Mico by name on import", () => {
    const document = exportWorkflowDraft(workflow, [{ id: "original-mico", name: "Mico" }]);
    expect(JSON.stringify(document)).not.toContain("original-mico");
    expect(importWorkflowDraft(document, [{ id: "new-mico", name: "Mico" }])).toMatchObject({
      unassigned: 0,
      graph: { nodes: [{ botId: "new-mico" }] },
    });
  });

  it("leaves absent and ambiguous Micos unassigned", () => {
    const document = exportWorkflowDraft(workflow, [{ id: "original-mico", name: "Mico" }]);
    for (const micos of [[], [{ id: "a", name: "Mico" }, { id: "b", name: "Mico" }]]) {
      const result = importWorkflowDraft(document, micos);
      expect(result?.unassigned).toBe(1);
      expect(result?.graph.nodes[0]).not.toHaveProperty("botId");
    }
  });

  it("accepts a legacy export without allowing out-of-Space assignments or activation", () => {
    const legacy = { ...workflow, id: "existing", version: 5, active: true, updatedAt: "2026-11-25", nextRunAt: null };
    const imported = importWorkflowDraft(legacy, []);
    expect(imported?.unassigned).toBe(1);
    expect(imported?.graph.nodes[0]).not.toHaveProperty("botId");
    expect(imported).not.toHaveProperty("active");
    expect(importWorkflowDraft({ ...legacy, format: "mycellios-workflow/2" }, [])).toBeNull();
  });
});
