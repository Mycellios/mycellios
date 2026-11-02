import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { AgentNetworkThread } from "./AgentNetworkThread";

it("reattaches every lateral branch to exact trunk vertices, including both ends", () => {
  const markup = renderToStaticMarkup(<AgentNetworkThread />);
  const trunk = markup.match(/class="agent-thread-root" d="([^"]+)"/)![1]!;
  const branches = markup.match(/class="agent-thread-branches" d="([^"]+)"/)![1]!;
  const vertices = [...trunk.matchAll(/[MCS]([^MCS]+)/g)].map(command => command[1]!.trim().split(/[ ,]+/).slice(-2).join(","));
  const attached = new Set<string>();
  for (const branch of branches.split("M").filter(Boolean)) {
    const [start, curve] = branch.split("C");
    const from = start!.trim().split(/[ ,]+/).join(","), to = curve!.trim().split(/[ ,]+/).slice(-2).join(",");
    expect(vertices).toContain(from); expect(vertices).toContain(to);
    attached.add(from); attached.add(to);
  }
  expect(attached.has(vertices[0]!)).toBe(true);
  expect(attached.has(vertices.at(-1)!)).toBe(true);
});
