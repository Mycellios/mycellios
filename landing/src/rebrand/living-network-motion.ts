import gsap from "gsap";
import { createSignalClock, easePointer, pointOnSamples, pointerPosition } from "./living-network-model";

export function animateLivingNetwork(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add({ moving: "(prefers-reduced-motion: no-preference)", fine: "(hover: hover) and (pointer: fine)", wide: "(min-width: 761px)" }, context => {
    if (!context.conditions?.moving) return;
    const fine = context.conditions.fine, wide = context.conditions.wide;
    const art = root.querySelector<HTMLElement>(".agent-network-depth")!;
    const spores = root.querySelector<HTMLElement>(".agent-spore-depth")!;
    const nodes = [...root.querySelectorAll<SVGGElement>(".agent-network-node-response")].map(node => ({ node, x: Number(node.parentElement!.getAttribute("data-node-x")), y: Number(node.parentElement!.getAttribute("data-node-y")), current: { x: 1, y: 0 }, target: { x: 1, y: 0 } }));
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
    let current = { x: 0, y: 0 }, target = { x: 0, y: 0 }, bounds: DOMRect | null = null, artBounds: DOMRect | null = null;
    gsap.set([art, spores], { x: 0, y: 0 });
    const artX = gsap.quickSetter(art, "x", "px"), artY = gsap.quickSetter(art, "y", "px");
    const sporesX = gsap.quickSetter(spores, "x", "px"), sporesY = gsap.quickSetter(spores, "y", "px");
    const render = (elapsed: number, delta: number) => {
      routes.forEach(route => route.pulses.forEach((pulse, index) => {
        if (!wide && index > 0) return;
        const phase = (elapsed / route.duration + route.offset + index * .5) % 1;
        const point = pointOnSamples(route.points, phase);
        pulse.setAttribute("transform", `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
        pulse.setAttribute("opacity", String(Math.min(1, phase / .05, (1 - phase) / .05)));
        if (index === 0) route.path.style.strokeDashoffset = String(route.length * (.025 - phase));
      }));
      if (fine && (Math.abs(current.x - target.x) > .00005 || Math.abs(current.y - target.y) > .00005)) {
        current = easePointer(current, target, delta);
        artX(-current.x * 8); artY(-current.y * 5);
        sporesX(-current.x * 14); sporesY(-current.y * 8);
      }
      if (fine) nodes.forEach(node => {
        if (Math.abs(node.current.x - node.target.x) < .0005 && Math.abs(node.current.y - node.target.y) < .0005) return;
        node.current = easePointer(node.current, node.target, delta);
        node.node.setAttribute("transform", `scale(${node.current.x})`);
        node.node.setAttribute("opacity", String(node.current.y));
      });
    };
    const clock = createSignalClock(gsap.ticker, render);
    const synchronize = () => clock.setActive(root.dataset.ambientRunning === "true" && !document.hidden);
    const visibility = () => { root.dataset.ambientHidden = String(document.hidden); synchronize(); };
    const invalidateBounds = () => { bounds = null; artBounds = null; };
    const move = (event: PointerEvent) => {
      if (!fine || event.pointerType !== "mouse" || root.dataset.ambientRunning !== "true") return;
      bounds ??= root.getBoundingClientRect();
      target = pointerPosition(event.clientX, event.clientY, bounds);
      artBounds ??= root.querySelector(".agent-network-breath")!.getBoundingClientRect();
      const x = (event.clientX - artBounds.left) / artBounds.width * 1774, y = (event.clientY - artBounds.top) / artBounds.height * 887;
      nodes.forEach(node => {
        const distance = Math.hypot((node.x - x) * artBounds!.width / 1774, (node.y - y) * artBounds!.height / 887);
        const proximity = Math.max(0, 1 - distance / 100);
        node.target = { x: 1 + proximity * .5, y: proximity * .8 };
      });
    };
    const leave = () => { target = { x: 0, y: 0 }; invalidateBounds(); nodes.forEach(node => { node.target = { x: 1, y: 0 }; }); };
    const observer = new MutationObserver(synchronize);
    observer.observe(root, { attributes: true, attributeFilter: ["data-ambient-running"] });
    const resize = new ResizeObserver(invalidateBounds);
    resize.observe(root);
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", invalidateBounds, { passive: true });
    document.addEventListener("visibilitychange", visibility);
    render(0, 0); visibility();
    return () => {
      clock.destroy(); observer.disconnect(); resize.disconnect();
      root.removeEventListener("pointermove", move); root.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", invalidateBounds); document.removeEventListener("visibilitychange", visibility);
      routes.forEach(route => {
        route.path.style.removeProperty("stroke-dasharray"); route.path.style.removeProperty("stroke-dashoffset");
        route.pulses.forEach(pulse => { pulse.setAttribute("opacity", "0"); pulse.removeAttribute("transform"); });
      });
      gsap.set([art, spores], { clearProps: "transform" });
      nodes.forEach(({ node }) => { node.setAttribute("opacity", "0"); node.removeAttribute("transform"); });
      delete root.dataset.ambientHidden;
    };
  });
  return () => media.revert();
}
