import { animate } from "motion/mini";

/** Activation flourish only. The persistent edge still follows verified connectivity. */
let layer: SVGSVGElement | undefined;
const animations: Array<{ cancel(): void }> = [];
let expiry: ReturnType<typeof setTimeout> | undefined;
export function stopContributionGrowth() {
  if (expiry) clearTimeout(expiry);
  expiry = undefined;
  for (const animation of animations.splice(0)) animation.cancel();
  layer?.remove(); layer = undefined;
}
export function startContributionGrowth(source: HTMLElement) {
  stopContributionGrowth();
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const seed = (source.querySelector(".rk-contribution-play") ?? source).getBoundingClientRect();
  const width = window.innerWidth, height = window.innerHeight;
  const x = seed.left + seed.width / 2, y = seed.top + seed.height / 2;
  if (!width || !height || !seed.width) return;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("rk-contribution-growth"); svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  // Confine the flourish to the control and the bottom edge, never the workspace.
  const edge = height - 6;
  const strokes: Array<{ path: SVGPathElement; delay: number }> = [];
  const add = (d: string, delay: number) => {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d); path.setAttribute("pathLength", "1");
    svg.append(path); strokes.push({ path, delay });
  };
  if (edge - y < 180) add(`M ${x} ${y + seed.height / 2} C ${x} ${y + 42} ${x - 18} ${edge - 20} ${x} ${edge}`, 0);
  add(`M ${x} ${edge} C ${x - 32} ${edge - 3} ${x * .35} ${edge} 0 ${edge}`, 120);
  add(`M ${x} ${edge} C ${x + 42} ${edge - 3} ${x + (width - x) * .6} ${edge} ${width} ${edge}`, 120);
  const ring = document.createElementNS(ns, "circle");
  ring.setAttribute("cx", String(x)); ring.setAttribute("cy", String(y));
  ring.setAttribute("r", String(seed.width / 2 + 3)); ring.setAttribute("pathLength", "1");
  const wave = ring.cloneNode() as SVGCircleElement;
  wave.setAttribute("class", "rk-mycelium-wave");
  svg.append(wave, ring);
  document.body.append(svg); layer = svg;
  for (const { path, delay } of strokes) animations.push(animate(path,
    { strokeDashoffset: ["1px", "0px"], opacity: [0, .95, .7, 0] },
    { duration: 1.8, delay: delay / 1000, ease: [.16, 1, .3, 1] }));
  animations.push(animate(ring, { strokeDashoffset: ["1px", "0px"], opacity: [0, 1, .8, 0] },
    { duration: 1.7, ease: [.16, 1, .3, 1] }));
  animations.push(animate(wave, { transform: ["scale(1)", "scale(3.6)"], opacity: [0, .65, .25, 0] },
    { duration: 1.85, ease: [.16, 1, .3, 1] }));
  expiry = setTimeout(stopContributionGrowth, 2100);
}
