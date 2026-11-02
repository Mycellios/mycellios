import type { NetworkPoint } from "./living-network-model";

type Edge = { id: string; from: string; to: string; closing?: boolean; signal?: boolean };
const sides = ["left", "right"] as const;
const levels = ["a", "b", "c", "d", "e", "f", "g"] as const;

export const rootedEdges: Edge[] = [
  ...sides.flatMap(side => [
    ...levels.slice(0, -1).map((level, i) => ({ id: `${side}-${level}`, from: `${side}-${level}`, to: `${side}-${levels[i + 1]}`, signal: i % 2 === 0 })),
    ...[["a", "c"], ["b", "d"], ["d", "f"], ["e", "g"]].map(([from, to]) => ({ id: `${side}-${from}-${to}`, from: `${side}-${from}`, to: `${side}-${to}` })),
    ...[0, 1, 2].map(i => ({ id: `${side}-mico-${i}`, from: `${side}-g`, to: "mico", closing: true })),
  ]),
  { id: "canopy", from: "left-a", to: "right-a", signal: true },
  { id: "bridge", from: "left-d", to: "right-d", signal: true },
];
export const rootedNodeIds = [...sides.flatMap(side => levels.map(level => `${side}-${level}`)), "mico"];

export type RootedLayout = {
  width: number;
  computeInset: number;
  questionInset: number;
  computeBottom: number;
  closingTop: number;
  emblemY: number;
  headingY: number;
};
type Curve = { edge: Edge; points: NetworkPoint[]; d: string };
const point = (x: number, y: number): NetworkPoint => ({ x, y });

/** Every curve uses shared graph vertices; the two chapters live in one SVG coordinate space. */
export function rootedNetworkGeometry(layout: RootedLayout) {
  const { width, computeBottom, closingTop, emblemY, headingY } = layout;
  const wide = width > 1250;
  const computeEdge = Math.max(8, Math.min(wide ? 170 : 18, layout.computeInset - 24));
  const questionEdge = Math.max(computeEdge, Math.min(wide ? 330 : 24, layout.questionInset - 30));
  const split = computeBottom - (width <= 760 ? 38 : 60), rest = closingTop - split;
  const feed = wide ? width / 6 : Math.max(12, computeEdge * .8);
  const nodes: Record<string, NetworkPoint> = { mico: point(width / 2, emblemY) };
  const left = [point(computeEdge * .6, 30), point(computeEdge * .35, split * .35), point(computeEdge * .8, split * .68), point(computeEdge * .5, split), point(questionEdge * .43, split + rest * .32), point(questionEdge * .73, split + rest * .72), point(feed, closingTop)];
  sides.forEach(side => levels.forEach((level, i) => { const p = left[i]!; nodes[`${side}-${level}`] = point(side === "left" ? p.x : width - p.x, p.y); }));
  const curves: Curve[] = rootedEdges.map(edge => {
    const start = nodes[edge.from]!, end = nodes[edge.to]!;
    let controls: NetworkPoint[];
    if (edge.closing) {
      const side = edge.from.startsWith("left") ? 1 : -1, variant = Number(edge.id.at(-1));
      const lower = Math.min(headingY - 16, emblemY + 72);
      controls = variant === 0 ? [point(start.x + side * width * .05, closingTop + 24), point(end.x - side * width * .22, emblemY - 60)]
        : variant === 1 ? [point(start.x + side * width * .21, lower), point(end.x - side * width * .14, emblemY + 34)]
        : [point(start.x, lower), point(end.x - side * width * .23, lower)];
    } else if (edge.id === "canopy" || edge.id === "bridge") {
      const bend = edge.id === "canopy" ? 24 : -18;
      controls = [point(start.x + width * .09, start.y - bend), point(width * .17, start.y + bend), point(width * .32, start.y + bend * .35), point(width * .44, start.y - bend * .6), point(width * .54, start.y + bend), point(width * .66, start.y + bend * .3), point(width * .76, start.y - bend * .5), point(end.x - width * .08, start.y + bend)];
    } else {
      const side = edge.from.startsWith("left") ? 1 : -1, distance = end.y - start.y;
      const gutter = edge.from.endsWith("a") || edge.from.endsWith("b") || edge.from.endsWith("c") ? computeEdge : questionEdge;
      const loop = edge.id.split("-").length > 2;
      const x = (fraction: number) => side === 1 ? gutter * fraction : width - gutter * fraction;
      controls = [point(x(loop ? .08 : .95), start.y + distance * .33), point(x(loop ? .12 : .15), end.y - distance * .28)];
    }
    const points = [start, ...controls, end];
    let d = `M${start.x} ${start.y}`;
    for (let i = 1; i < points.length; i += 3) d += `C${points.slice(i, i + 3).map(p => `${p.x} ${p.y}`).join(" ")}`;
    return { edge, points, d };
  });
  return { width, height: headingY - 8, nodes, curves };
}
