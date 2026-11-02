import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { createSignalClock, pointOnSamples, type NetworkPoint } from "./living-network-model";
import { rootedEdges, rootedNetworkGeometry, rootedNodeIds } from "./rooted-network-geometry";

type TailRoute = { light: SVGGElement; samples: NetworkPoint[]; duration: number; offset: number };

/** Layout-aware roots stay outside the content columns, including expanded answers. */
export function AgentTailBackdrop({ tail, section, paused, root }: { tail: HTMLElement; section: HTMLElement; paused: boolean; root: RefObject<SVGSVGElement | null> }) {
  const pausedIntent = useRef(paused), synchronizeMotion = useRef(() => {});
  useEffect(() => { pausedIntent.current = paused; synchronizeMotion.current(); }, [paused]);
  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const contribute = tail.querySelector<HTMLElement>(".reference-contribute")!, questions = tail.querySelector<HTMLElement>(".reference-questions")!;
    const owner = tail.closest<HTMLElement>("[data-journey-running]");
    let routes: TailRoute[] = [];
    const layout = () => {
      const bounds = tail.getBoundingClientRect(), computeBounds = contribute.getBoundingClientRect(), questionBounds = questions.getBoundingClientRect(), closingBounds = section.getBoundingClientRect();
      const emblem = section.querySelector(".agent-closing-emblem")!.getBoundingClientRect(), heading = section.querySelector("h2")!.getBoundingClientRect();
      const geometry = rootedNetworkGeometry({ width: bounds.width, computeInset: computeBounds.left - bounds.left, questionInset: questionBounds.left - bounds.left, computeBottom: computeBounds.bottom - bounds.top, closingTop: closingBounds.top - bounds.top, emblemY: emblem.top + emblem.height / 2 - bounds.top, headingY: heading.top - bounds.top });
      svg.setAttribute("viewBox", `0 0 ${geometry.width} ${geometry.height}`); svg.style.height = `${geometry.height}px`;
      geometry.curves.forEach(({ edge, d }) => {
        svg.querySelectorAll<SVGPathElement>(`[data-edge="${edge.id}"] > path`).forEach(path => path.setAttribute("d", d));
      });
      Object.entries(geometry.nodes).forEach(([id, point]) => svg.querySelector(`[data-node="${id}"]`)!.setAttribute("transform", `translate(${point.x} ${point.y})`));
      routes = [...svg.querySelectorAll<SVGGElement>(".agent-tail-route")].map((group, index) => {
        const path = group.querySelector<SVGPathElement>("path")!, length = path.getTotalLength();
        return { light: group.querySelector<SVGGElement>(".agent-tail-signal")!, samples: Array.from({ length: 65 }, (_, sample) => { const point = path.getPointAtLength(length * sample / 64); return { x: point.x, y: point.y }; }), duration: 11 + index * 1.2, offset: index * .137 };
      });
    };
    layout();
    const resize = new ResizeObserver(layout);
    [tail, contribute, questions, section].forEach(element => resize.observe(element));
    const media = gsap.matchMedia(tail);
    media.add("(prefers-reduced-motion: no-preference)", () => {
      let inView = false;
      const clock = createSignalClock(gsap.ticker, elapsed => routes.forEach(route => {
        const phase = (elapsed / route.duration + route.offset) % 1, point = pointOnSamples(route.samples, phase);
        route.light.setAttribute("transform", `translate(${point.x} ${point.y})`);
        route.light.setAttribute("opacity", String(Math.min(1, phase / .05, (1 - phase) / .05)));
      }));
      const synchronize = () => clock.setActive(inView && !pausedIntent.current && !document.hidden && owner?.dataset.journeyRunning !== "false");
      synchronizeMotion.current = synchronize;
      const viewport = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; synchronize(); });
      viewport.observe(svg);
      const playback = new MutationObserver(synchronize);
      if (owner) playback.observe(owner, { attributes: true, attributeFilter: ["data-journey-running"] });
      document.addEventListener("visibilitychange", synchronize);
      return () => {
        clock.destroy(); viewport.disconnect(); playback.disconnect(); document.removeEventListener("visibilitychange", synchronize);
        synchronizeMotion.current = () => {};
        routes.forEach(route => { route.light.setAttribute("opacity", "0"); route.light.removeAttribute("transform"); });
      };
    });
    return () => { resize.disconnect(); media.revert(); };
  }, [tail, section, root]);
  return <svg ref={root} className="agent-tail-mycelium" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    {rootedEdges.map(edge => <g key={edge.id} data-edge={edge.id} data-from={edge.from} data-to={edge.to} className={edge.closing ? "agent-closing-root" : edge.signal ? "agent-tail-route" : "agent-tail-branch"}>
      <path className={edge.closing ? "agent-closing-quiet" : undefined} vectorEffect="non-scaling-stroke" />
      {edge.closing && <path className="agent-closing-live" strokeDasharray="0 100000" vectorEffect="non-scaling-stroke" />}
      {(edge.signal || edge.closing) && <g className={edge.closing ? "agent-closing-signal" : "agent-tail-signal"} opacity="0"><circle className="agent-tail-halo" r="8" /><circle r="2.5" /></g>}
    </g>)}
    <g className="agent-rooted-junctions">{rootedNodeIds.map(id => <g key={id} data-node={id}><circle r={id === "mico" ? 0 : 2.2} /></g>)}</g>
  </svg>;
}
