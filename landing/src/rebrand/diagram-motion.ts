import type gsap from "gsap";
import { pointOnSamples } from "./living-network-model";

type Point = { x: number; y: number };
export function curveBetweenPorts(from: Point, to: Point, vertical: boolean) {
  const bend = vertical ? (from.y + to.y) / 2 : (from.x + to.x) / 2;
  return vertical ? `M${from.x} ${from.y}C${from.x} ${bend} ${to.x} ${bend} ${to.x} ${to.y}`
    : `M${from.x} ${from.y}C${bend} ${from.y} ${bend} ${to.y} ${to.x} ${to.y}`;
}

/** Connect visible DOM ports in CSS pixels; only resample when layout changes. */
export function connectProductDiagrams(root: HTMLElement) {
  const diagram = root.querySelector<HTMLElement>("[data-product-diagram]");
  const svg = diagram?.querySelector<SVGSVGElement>(".product-diagram-links");
  if (!diagram || !svg) return null;
  const traces = [...svg.querySelectorAll<SVGPathElement>("[data-route-trace]")], packets = [...svg.querySelectorAll<SVGGElement>("[data-route-packet]")];
  const routes = [...svg.querySelectorAll<SVGPathElement>("[data-route-line]")].map((path, index) => ({ path, trace: traces[index]!, packet: packets[index]!, progress: { value: 0 }, length: 0, samples: [{ x: 0, y: 0 }] }));
  const paint = (index: number) => {
    const route = routes[index]!;
    const point = pointOnSamples(route.samples, route.progress.value);
    route.packet.setAttribute("transform", `translate(${point.x} ${point.y})`);
    route.trace.style.strokeDashoffset = String(route.length * (1 - route.progress.value));
  };
  const measure = () => {
    const bounds = svg.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    routes.forEach((route, index) => {
      const from = diagram.querySelector<HTMLElement>(`[data-route-port="${route.path.dataset.routeFrom}"]`)!.getBoundingClientRect();
      const to = diagram.querySelector<HTMLElement>(`[data-route-port="${route.path.dataset.routeTo}"]`)!.getBoundingClientRect();
      const mobile = window.matchMedia("(max-width:760px)").matches;
      const vertical = diagram.dataset.productDiagram === "collaboration" ? mobile : !mobile && bounds.width > 420;
      const d = curveBetweenPorts({ x: from.left + from.width / 2 - bounds.left, y: from.top + from.height / 2 - bounds.top }, { x: to.left + to.width / 2 - bounds.left, y: to.top + to.height / 2 - bounds.top }, vertical);
      route.path.setAttribute("d", d); route.trace.setAttribute("d", d); route.length = route.path.getTotalLength();
      route.trace.style.strokeDasharray = String(route.length);
      route.samples = Array.from({ length: 61 }, (_, i) => { const point = route.path.getPointAtLength(route.length * i / 60); return { x: point.x, y: point.y }; }); paint(index);
    });
  };
  measure(); const resize = new ResizeObserver(measure); resize.observe(diagram);
  return {
    animate(loop: gsap.core.Timeline) {
      if (diagram.dataset.productDiagram === "collaboration") {
        const contributions = root.querySelectorAll("[data-contribution]"), footer = root.querySelector(".collaboration-paper footer")!;
        loop.repeatDelay(.4).set(contributions, { opacity: .5 }, 0).set(footer, { opacity: .5 }, 0).set(traces, { opacity: 0 }, 0).set(packets, { opacity: 0 }, 0);
        routes.forEach((route, index) => {
          const start = index * 3.2;
          loop.call(() => { root.dataset.collaborationStep = String(index); }, [], start)
            .set(route.trace, { opacity: 1 }, start + .8).to(route.packet, { opacity: 1, duration: .2 }, start + .8)
            .fromTo(route.progress, { value: 0 }, { value: 1, duration: 1.2, ease: "power2.inOut", immediateRender: false, onUpdate: () => paint(index) }, start + .8)
            .to(route.packet, { opacity: 0, duration: .2 }, start + 1.8)
            .to(contributions[index]!, { opacity: 1, duration: .4 }, start + 2)
            .to(route.trace, { opacity: .4, duration: .4 }, start + 2);
        });
        loop.call(() => { root.dataset.collaborationStep = "3"; }, [], 9.6).to(footer, { opacity: 1, duration: .4 }, 9.6).addLabel("settled", 10.4).to({}, { duration: 3.2 }, 10.4);
      } else {
        routes.forEach((route, i) => {
          loop.set(route.trace, { opacity: 1 }, 0).to(route.packet, { opacity: 1, duration: .2 }, .4)
            .fromTo(route.progress, { value: 0 }, { value: 1, duration: 1.6, ease: "power2.inOut", immediateRender: false, onUpdate: () => paint(i) }, .4)
            .to(route.packet, { opacity: 0, duration: .2 }, 1.8);
        });
      }
    },
    settle() { if (diagram.dataset.productDiagram === "collaboration") root.dataset.collaborationStep = "3"; },
    destroy() { resize.disconnect(); delete root.dataset.collaborationStep; },
  };
}
