import gsap from "gsap";
import { pointOnSamples, type NetworkPoint } from "./living-network-model";

/** One transfer leads the eye; agents, text and connection ports stay anchored. */
export function buildCollaboration(root: HTMLElement, loop: gsap.core.Timeline) {
  const network = root.querySelector<HTMLElement>(".story-network")!;
  const svg = network.querySelector<SVGSVGElement>("svg")!;
  const nodes = [...network.querySelectorAll<HTMLElement>("[data-story-node]")];
  const paths = [...svg.querySelectorAll<SVGPathElement>("[data-story-path]")];
  const traces = [...svg.querySelectorAll<SVGPathElement>("[data-story-trace]")];
  const packets = [...svg.querySelectorAll<SVGGElement>("[data-story-packet]")];
  const sprouts = [...svg.querySelectorAll<SVGGElement>("[data-story-sprout]")];
  const anchors = [...svg.querySelectorAll<SVGGElement>("[data-story-sprout-anchor]")];
  const result = network.querySelector<HTMLElement>("[data-story-result]")!;
  const routes: NetworkPoint[][] = paths.map(() => []);
  const lengths = paths.map(() => 0);
  const progress = paths.map(() => ({ value: 0 }));
  const placePacket = (index: number) => {
    const point = pointOnSamples(routes[index]!, progress[index]!.value);
    packets[index]!.setAttribute("transform", `translate(${point.x} ${point.y})`);
    traces[index]!.style.strokeDashoffset = String(lengths[index]! * (1 - progress[index]!.value));
  };
  const measure = () => {
    const bounds = network.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const center = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 - bounds.left, y: rect.top + rect.height / 2 - bounds.top };
    };
    const ports = nodes.map(node => center(node.querySelector(".story-node-port")!));
    const destination = center(result.querySelector(".story-result-port")!);
    svg.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
    paths.forEach((path, index) => {
      const a = ports[index]!, b = ports[index + 1] ?? destination;
      const y = index < 2 ? Math.max(a.y, b.y) + 64 : b.y - 20;
      path.setAttribute("d", `M${a.x} ${a.y} C${a.x} ${y} ${b.x} ${y} ${b.x} ${b.y}`);
      const length = path.getTotalLength();
      lengths[index] = length;
      traces[index]!.setAttribute("d", path.getAttribute("d")!);
      traces[index]!.style.strokeDasharray = String(length);
      routes[index] = Array.from({ length: 81 }, (_, sample) => {
        const point = path.getPointAtLength(length * sample / 80);
        return { x: point.x, y: point.y };
      });
      const bud = pointOnSamples(routes[index]!, .38);
      anchors[index]!.setAttribute("transform", `translate(${bud.x} ${bud.y})`);
      placePacket(index);
    });
  };
  measure();
  const resize = new ResizeObserver(measure);
  resize.observe(network);
  loop.repeatDelay(.4);
  loop.call(() => { root.dataset.collaborationStep = "0"; }, [], 0)
    .to(nodes.map(node => node.querySelector("small")), { opacity: .45, duration: .4 }, 0)
    .set(nodes.map(node => node.querySelector(".story-agent-activity")), { opacity: 0 }, 0)
    .set(packets, { opacity: 0 }, 0)
    .to(traces, { opacity: 0, duration: .4 }, 0)
    .set(sprouts, { clipPath: "inset(100% -4px 0% -4px)", opacity: 0 }, 0)
    .to(result, { opacity: .65, duration: .4 }, 0);
  nodes.forEach((node, index) => {
    const start = index * 3.2, send = start + 1.6;
    const face = node.querySelector(".mico-face")!, activity = node.querySelector(".story-agent-activity")!;
    loop.call(() => { root.dataset.collaborationStep = String(index); }, [], start)
      .to(activity, { opacity: 1, duration: .2 }, start)
      .to(face, { "--mico-look-x": index === 2 ? "-1px" : "1px", duration: .4 }, start + .4)
      .to(activity, { opacity: 0, duration: .2 }, send - .2)
      .to(node.querySelector("small"), { opacity: 1, duration: .4 }, send - .2)
      .fromTo(node.querySelector("small > svg"), { opacity: 0 }, { opacity: 1, duration: .4, immediateRender: false }, send - .2)
      .set(traces[index]!, { opacity: 1 }, send)
      .to(packets[index]!, { opacity: 1, duration: .2 }, send)
      .fromTo(progress[index]!, { value: 0 }, { value: 1, duration: .8, ease: "power2.inOut", immediateRender: false, onUpdate: () => placePacket(index) }, send)
      .to(packets[index]!, { opacity: 0, duration: .2 }, send + .6)
      .to(traces[index]!, { opacity: .55, duration: .4 }, send + .8)
      .to(sprouts[index]!, { clipPath: "inset(0% -4px 0% -4px)", opacity: 1, duration: .8 }, send + .8)
      .to(face, { "--mico-look-x": "0px", duration: .4 }, send + .8);
  });
  loop.call(() => { root.dataset.collaborationStep = "3"; }, [], 8.8)
    .to(result, { opacity: 1, duration: .4 }, 8.8)
    .fromTo(result.querySelector("svg:last-child"), { opacity: 0, y: 3 }, { opacity: 1, y: 0, duration: .4, immediateRender: false }, 8.8)
    .addLabel("settled", 9.6)
    .to(sprouts, { opacity: 0, duration: .4 }, 12.8);
  return () => {
    resize.disconnect(); delete root.dataset.collaborationStep;
    packets.forEach(packet => packet.removeAttribute("transform"));
    traces.forEach(trace => { trace.style.removeProperty("stroke-dasharray"); trace.style.removeProperty("stroke-dashoffset"); });
  };
}
