import { animate } from "motion/mini";

/**
 * Activation flourish only: a short sprout of ripples and spores around the control, then gone.
 * The persistent edge still follows verified connectivity.
 */
let layer: SVGSVGElement | undefined;
const animations: Array<{ cancel(): void }> = [];
let expiry: ReturnType<typeof setTimeout> | undefined;
const SPORES = 9;
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
  const radius = seed.width / 2;
  const circle = (r: number, className: string) => {
    const node = document.createElementNS(ns, "circle");
    node.setAttribute("cx", String(x)); node.setAttribute("cy", String(y));
    node.setAttribute("r", String(r)); node.setAttribute("class", className);
    svg.append(node);
    return node;
  };
  // Two quick, thin ripples stay close to the control.
  const ripples = [circle(radius, "rk-growth-ripple"), circle(radius, "rk-growth-ripple")];
  // Spores leave the rim at even angles (slightly varied) and fade as they drift out.
  const spores = Array.from({ length: SPORES }, (_, index) => {
    const angle = (index / SPORES) * Math.PI * 2 + (index % 2 ? 0.18 : -0.12);
    const reach = radius + 14 + (index % 3) * 6;
    const node = circle(index % 3 === 0 ? 2.4 : 1.7, "rk-growth-spore");
    return { node, dx: Math.cos(angle) * reach, dy: Math.sin(angle) * reach, delay: (index % 3) * 0.04 };
  });
  document.body.append(svg); layer = svg;
  ripples.forEach((ripple, index) => animations.push(animate(ripple,
    { transform: ["scale(1)", `scale(${index ? 2.1 : 1.7})`], opacity: [0, 0.7, 0] },
    { duration: 0.9, delay: index * 0.14, ease: [.16, 1, .3, 1] })));
  for (const { node, dx, dy, delay } of spores) animations.push(animate(node,
    { transform: ["translate(0px, 0px) scale(.4)", `translate(${dx}px, ${dy}px) scale(1)`], opacity: [0, 1, 0] },
    { duration: 1.05, delay, ease: [.22, 1, .36, 1] }));
  expiry = setTimeout(stopContributionGrowth, 1300);
}
