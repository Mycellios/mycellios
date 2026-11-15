import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { distributedEarnArtwork } from "./distributed-earn-model";
import { DistributedEarnScene } from "./DistributedEarnScene";

describe("distributed earning illustration", () => {
  const { nodes, edges } = distributedEarnArtwork();
  it("keeps the desktop and mobile peer meshes connected without duplicate links", () => {
    expect(new Set(edges.map(edge => edge.id)).size).toBe(edges.length);
    for (const mobile of [false, true]) {
      const displayed = nodes.filter(node => !mobile || node.mobile);
      const visibleEdges = edges.filter(edge => !mobile || edge.mobile);
      const reached = new Set([displayed[0]!.id]);
      let previous = 0;
      while (reached.size !== previous) {
        previous = reached.size;
        for (const edge of visibleEdges) {
          if (reached.has(edge.from)) reached.add(edge.to);
          if (reached.has(edge.to)) reached.add(edge.from);
        }
      }
      expect([...reached].sort((a, b) => a - b)).toEqual(displayed.map(node => node.id));
    }
  });
  it("has stable bounded artwork with valid endpoints and no self links", () => {
    expect(nodes).toHaveLength(49);
    expect(distributedEarnArtwork()).toEqual({ nodes, edges });
    for (const node of nodes) {
      expect(node.x).toBeGreaterThan(35); expect(node.x).toBeLessThan(1165);
      expect(node.y).toBeGreaterThan(30); expect(node.y).toBeLessThan(530);
    }
    for (const edge of edges) {
      expect(edge.from).not.toBe(edge.to);
      expect(edge.path).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
  it("explains verified credits and keeps joining explicit without pretending to show a real balance", () => {
    const html = renderToStaticMarkup(<DistributedEarnScene />);
    expect(html).toContain("Use AI for free.");
    expect(html).toContain("completed, verified inference");
    expect(html).toContain('href="#join-network"');
    expect(html).toContain("Network illustration");
    expect(html).toContain("network demand");
    expect(html).toContain('data-ambient-running="false"');
    expect(html).toContain('aria-label="Pause network animation"');
    expect(html).not.toContain("/assets/agent-demo/mico.svg");
    expect(html).not.toContain("USDC");
  });
  it("keeps the entire mesh static when page animations are paused", () => {
    const html = renderToStaticMarkup(<DistributedEarnScene running={false} />);
    expect(html).toContain('data-ambient-running="false"');
    expect(html).toMatch(/<button(?=[^>]*disabled)(?=[^>]*aria-label="Pause network animation")/);
  });
});
