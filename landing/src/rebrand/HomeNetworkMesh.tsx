import { useEffect, useRef, useState } from "react";
import { Laptop, Monitor, Pause, Play, Server, Smartphone } from "lucide-react";
import { Button } from "../ui/primitives";

type Kind = "phone" | "laptop" | "desktop" | "server";
const ICONS = { phone: Smartphone, laptop: Laptop, desktop: Monitor, server: Server } as const;

/** Deterministic conceptual peer mesh: mixed devices, several links per node. Not telemetry. */
const NODES: ReadonlyArray<readonly [number, number, Kind]> = [
  [70, 90, "laptop"], [210, 50, "phone"], [330, 130, "server"], [470, 60, "desktop"], [610, 120, "phone"], [740, 70, "laptop"],
  [120, 230, "desktop"], [260, 260, "phone"], [410, 230, "laptop"], [560, 270, "server"], [700, 230, "desktop"],
  [60, 360, "phone"], [200, 380, "server"], [350, 350, "desktop"], [500, 390, "phone"], [650, 370, "laptop"], [770, 340, "phone"],
];
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 6], [1, 2], [1, 3], [2, 3], [2, 7], [2, 8], [3, 4], [3, 8], [4, 5], [4, 9], [5, 10], [6, 7], [6, 11], [6, 12],
  [7, 8], [7, 13], [8, 9], [8, 13], [9, 10], [9, 14], [9, 15], [10, 16], [10, 15], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [4, 10],
];
const PACKETS = [[0, 6, 7, 8, 9, 15], [1, 3, 4, 10, 16], [11, 12, 13, 8, 3, 4, 5], [2, 7, 13, 14, 15], [5, 10, 9, 8, 2, 1]];

function route(path: number[]) {
  return path.map((index, step) => `${step ? "L" : "M"}${NODES[index]![0]} ${NODES[index]![1]}`).join(" ");
}

export function HomeNetworkMesh() {
  const root = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const [userPaused, setUserPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
    if (root.current) observer.observe(root.current);
    const hidden = () => setTabHidden(document.hidden);
    document.addEventListener("visibilitychange", hidden);
    return () => { media.removeEventListener("change", update); observer.disconnect(); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const running = visible && !tabHidden && !userPaused && !reduced;
  useEffect(() => {
    const element = svg.current;
    if (!element?.pauseAnimations) return;
    if (running) element.unpauseAnimations(); else element.pauseAnimations();
  }, [running]);
  return <div ref={root} className="home-mesh" data-running={running}>
    <svg ref={svg} viewBox="0 0 840 440" role="img" aria-label="Conceptual peer network: phones, laptops, desktop computers and servers connected to several peers">
      <g className="home-mesh-edges">{EDGES.map(([a, b]) => <line key={`${a}-${b}`} x1={NODES[a]![0]} y1={NODES[a]![1]} x2={NODES[b]![0]} y2={NODES[b]![1]} />)}</g>
      {!reduced && <g className="home-mesh-packets">{PACKETS.map((path, index) => <circle key={index} r="3.5">
        <animateMotion dur={`${5 + index * 1.3}s`} begin={`${-index * 1.7}s`} repeatCount="indefinite" path={route(path)} />
      </circle>)}</g>}
      <g className="home-mesh-nodes">{NODES.map(([x, y, kind], index) => {
        const Icon = ICONS[kind];
        return <g key={index} transform={`translate(${x} ${y})`} style={{ ["--node" as string]: index }}>
          <circle className="home-mesh-pulse" r="22" />
          <circle className="home-mesh-node" r="20" />
          <Icon x={-9} y={-9} width={18} height={18} strokeWidth={1.7} aria-hidden="true" />
        </g>;
      })}</g>
    </svg>
    {!reduced && <Button variant="ghost" className="home-mesh-toggle" aria-pressed={userPaused} aria-label={userPaused ? "Play network animation" : "Pause network animation"} onClick={() => setUserPaused(value => !value)}>{userPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}</Button>}
  </div>;
}
