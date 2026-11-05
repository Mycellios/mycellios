import gsap from "gsap";
import { pointOnSamples } from "./living-network-model";
import { createDemoAutoplay } from "./demo-autoplay";

function observePlayback(root: Element, change: (active: boolean) => void) {
  const owner = root.closest<HTMLElement>("[data-journey-running]");
  const synchronize = () => change(!document.hidden && owner?.dataset.journeyRunning !== "false" && root.getAttribute("data-ambient-running") !== "false");
  const observer = new MutationObserver(synchronize);
  if (owner) observer.observe(owner, { attributes: true, attributeFilter: ["data-journey-running"] });
  observer.observe(root, { attributes: true, attributeFilter: ["data-ambient-running"] });
  document.addEventListener("visibilitychange", synchronize);
  synchronize();
  return () => { observer.disconnect(); document.removeEventListener("visibilitychange", synchronize); };
}

export function animateCasePreview(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add("(prefers-reduced-motion: no-preference)", () => {
    if (root.closest<HTMLElement>("[data-journey-running]")?.dataset.journeyRunning === "false") return;
    const sequence = gsap.timeline({ defaults: { ease: "power3.out" } })
      .fromTo(root, { opacity: .7, y: 6 }, { opacity: 1, y: 0, duration: .4 })
      .from(root.querySelectorAll(".agent-case-document dl > div"), { opacity: .35, x: 6, duration: .6, stagger: .16 }, .2);
    return observePlayback(root, active => sequence.paused(!active));
  });
  return () => media.revert();
}

export function animateMicoGreeting(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add({ moving: "(prefers-reduced-motion: no-preference)", reduced: "(prefers-reduced-motion: reduce)" }, context => {
    const button = root.querySelector<HTMLButtonElement>(".agent-mico-greeting")!;
    button.disabled = !!context.conditions?.reduced;
    if (!context.conditions?.moving) return () => { button.disabled = false; };
    const face = button.querySelector(".mico-face")!;
    let active = false, started = false;
    const salute = gsap.timeline({ paused: true })
      .to(face, { "--mico-look-y": "1px", duration: .4, ease: "power2.inOut" })
      .to(face, { "--mico-look-y": "0px", duration: .4, ease: "power3.out" }, .8);
    const greet = () => { if (active) { started = true; salute.restart(); } };
    const idle = createDemoAutoplay(root, greet, { duration: 9600 });
    const stopPlayback = observePlayback(root, value => {
      active = value;
      if (!active) salute.pause();
      else if (!started) greet();
      else if (salute.progress() < 1) salute.play();
    });
    button.addEventListener("pointerenter", greet); button.addEventListener("focus", greet); button.addEventListener("click", greet);
    return () => { idle.destroy(); stopPlayback(); button.removeEventListener("pointerenter", greet); button.removeEventListener("focus", greet); button.removeEventListener("click", greet); };
  });
  return () => media.revert();
}

/** A scroll-linked filament. No pinning or movement of the surrounding artwork. */
export function animateNetworkThread(root: SVGSVGElement) {
  const media = gsap.matchMedia();
  media.add("(prefers-reduced-motion: no-preference)", () => {
    const body = root.parentElement!, path = root.querySelector<SVGPathElement>(".agent-thread-progress")!;
    const light = root.querySelector<SVGGElement>(".agent-thread-light")!, length = path.getTotalLength();
    const points = Array.from({ length: 101 }, (_, index) => { const point = path.getPointAtLength(length * index / 100); return { x: point.x, y: point.y }; });
    const progress = { value: 0 };
    let frame = 0, active = true;
    path.style.strokeDasharray = String(length);
    const paint = () => {
      const point = pointOnSamples(points, progress.value);
      const { a, d } = root.getScreenCTM()!;
      path.style.strokeDashoffset = String(length * (1 - progress.value));
      // Undo the SVG viewport stretch so the marker keeps its size in CSS pixels.
      light.setAttribute("transform", `translate(${point.x} ${point.y}) scale(${1 / a} ${1 / d})`);
      light.setAttribute("opacity", String(Math.min(1, progress.value / .025, (1 - progress.value) / .025)));
    };
    const scrub = gsap.quickTo(progress, "value", { duration: .3, ease: "power1.out", onUpdate: paint });
    const update = () => {
      frame = 0;
      if (!active) return;
      const bounds = body.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) { scrub.tween.pause(); return; }
      scrub(Math.max(0, Math.min(1, (window.innerHeight * .7 - bounds.top) / Math.max(1, bounds.height - window.innerHeight * .2))));
    };
    const schedule = () => { if (active && !frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(body);
    window.addEventListener("scroll", schedule, { passive: true }); window.addEventListener("resize", schedule);
    const stopPlayback = observePlayback(root, value => {
      active = value;
      if (active) schedule();
      else { cancelAnimationFrame(frame); frame = 0; scrub.tween.pause(); }
    });
    paint();
    return () => {
      stopPlayback(); resize.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule);
      path.style.removeProperty("stroke-dasharray"); path.style.removeProperty("stroke-dashoffset");
      light.removeAttribute("transform"); light.setAttribute("opacity", "0");
    };
  });
  return () => media.revert();
}
