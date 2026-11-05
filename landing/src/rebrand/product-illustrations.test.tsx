import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollaborationDesk, ContextDocument, ModelPatchbay, RoutineTimeline } from "./ProductIllustrations";
import { curveBetweenPorts } from "./diagram-motion";

describe("distinct 2D product examples", () => {
  it("connects all contributors and connection choices to declared output ports", () => {
    for (const html of [renderToStaticMarkup(<CollaborationDesk />), renderToStaticMarkup(<ModelPatchbay selected={0} onSelect={() => {}} />)]) {
      const ports = [...html.matchAll(/data-route-port="([^"]+)"/g)].map(match => match[1]);
      const lines = [...html.matchAll(/data-route-from="([^"]+)" data-route-to="([^"]+)"/g)];
      expect(lines).toHaveLength(3); expect(new Set(ports).size).toBe(ports.length);
      for (const [, from, to] of lines) { expect(ports).toContain(from); expect(ports).toContain(to); }
      expect(html).not.toContain("<canvas");
    }
  });

  it("keeps both cubic endpoints exactly on the ports in either responsive orientation", () => {
    for (const vertical of [true, false]) for (const [from, to] of [[{ x: 0, y: 35 }, { x: 270, y: 160 }], [{ x: 174.25, y: 120.5 }, { x: 174.25, y: 280.125 }]]) {
      const coordinates = curveBetweenPorts(from!, to!, vertical).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(coordinates.slice(0, 2)).toEqual([from!.x, from!.y]);
      expect(coordinates.slice(-2)).toEqual([to!.x, to!.y]);
      expect(coordinates.every(Number.isFinite)).toBe(true);
      expect(coordinates[vertical ? 2 : 3]).toBe(vertical ? from!.x : from!.y);
      expect(coordinates[vertical ? 4 : 5]).toBe(vertical ? to!.x : to!.y);
    }
  });

  it("shows only the scheduled days for weekly routines", () => {
    const daily = renderToStaticMarkup(<RoutineTimeline selected={0} time="09:00" file="Morning brief.md" />);
    const weekly = renderToStaticMarkup(<RoutineTimeline selected={2} time="16:00" file="Weekly wrap-up.md" />);
    expect((daily.match(/class="is-scheduled"/g) ?? [])).toHaveLength(5);
    expect((weekly.match(/class="is-scheduled"/g) ?? [])).toHaveLength(1);
    expect(weekly).toContain("Weekly wrap-up.md"); expect(weekly).toContain("16:00");
  });

  it("keeps permission metadata consistent with the choice", () => {
    const denied = renderToStaticMarkup(<ContextDocument decision="denied" />);
    expect(denied).toContain("Access declined"); expect(denied).toContain("Not granted");
    expect(denied).not.toContain("Waiting for your decision");
    const allowed = renderToStaticMarkup(<ContextDocument decision="allowed" />);
    expect(allowed).toContain("Allowed once"); expect(allowed).toContain("This example only");
  });
});
