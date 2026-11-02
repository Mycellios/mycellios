import gsap from "gsap";
import { createSignalClock, pointOnSamples } from "./living-network-model";

export function animateLivingNetwork(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add({ moving: "(prefers-reduced-motion: no-preference)", wide: "(min-width: 761px)" }, context => {
    if (!context.conditions?.moving) return;
    const wide = context.conditions.wide;
    const routes = [...root.querySelectorAll<SVGGElement>(".agent-signal-route")].map((group, index) => {
      const path = group.querySelector<SVGPathElement>("path")!, length = path.getTotalLength();
      // Sample geometry once; frames only interpolate these points and write transforms.
      const points = Array.from({ length: 81 }, (_, sample) => {
        const point = path.getPointAtLength(length * sample / 80);
        return { x: point.x, y: point.y };
      });
      path.style.strokeDasharray = `${length * .025} ${length}`;
      return { path, length, points, pulses: [...group.querySelectorAll<SVGGElement>(".agent-signal-point")], duration: 12 + index * 1.7, offset: index * .137 };
    });
    const render = (elapsed: number) => {
      routes.forEach(route => route.pulses.forEach((pulse, index) => {
        if (!wide && index > 0) return;
        const phase = (elapsed / route.duration + route.offset + index * .5) % 1;
        const point = pointOnSamples(route.points, phase);
        pulse.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
        pulse.setAttribute("opacity", String(Math.min(1, phase / .05, (1 - phase) / .05)));
        if (index === 0) route.path.style.strokeDashoffset = String(route.length * (.025 - phase));
      }));
    };
    const clock = createSignalClock(gsap.ticker, render);
    const synchronize = () => clock.setActive(root.dataset.ambientRunning === "true" && !document.hidden);
    const visibility = () => { root.dataset.ambientHidden = String(document.hidden); synchronize(); };
    const observer = new MutationObserver(synchronize);
    observer.observe(root, { attributes: true, attributeFilter: ["data-ambient-running"] });
    document.addEventListener("visibilitychange", visibility);
    render(0); visibility();
    return () => {
      clock.destroy(); observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      routes.forEach(route => {
        route.path.style.removeProperty("stroke-dasharray"); route.path.style.removeProperty("stroke-dashoffset");
        route.pulses.forEach(pulse => { pulse.setAttribute("opacity", "0"); pulse.removeAttribute("transform"); });
      });
      delete root.dataset.ambientHidden;
    };
  });
  return () => media.revert();
}
