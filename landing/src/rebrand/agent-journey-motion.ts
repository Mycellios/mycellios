import gsap from "gsap";
import { pointOnSamples } from "./living-network-model";

function observePlayback(root: Element, change: (active: boolean) => void) {
  const owner = root.closest<HTMLElement>("[data-journey-running]");
  const synchronize = () => change(!document.hidden && owner?.dataset.journeyRunning !== "false");
  const observer = new MutationObserver(synchronize);
  if (owner) observer.observe(owner, { attributes: true, attributeFilter: ["data-journey-running"] });
  document.addEventListener("visibilitychange", synchronize);
  synchronize();
  return () => { observer.disconnect(); document.removeEventListener("visibilitychange", synchronize); };
}

export function animateCasePreview(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add("(prefers-reduced-motion: no-preference)", () => {
    if (root.closest<HTMLElement>("[data-journey-running]")?.dataset.journeyRunning === "false") return;
    const tween = gsap.fromTo(root, { opacity: .65, y: 8 }, { opacity: 1, y: 0, duration: .35, ease: "power2.out" });
    return observePlayback(root, active => tween.paused(!active));
  });
  return () => media.revert();
}

export function animateMicoGreeting(root: HTMLElement) {
  const media = gsap.matchMedia(root);
  media.add({ moving: "(prefers-reduced-motion: no-preference)", reduced: "(prefers-reduced-motion: reduce)" }, context => {
    const button = root.querySelector<HTMLButtonElement>(".agent-mico-greeting")!;
    button.disabled = !!context.conditions?.reduced;
    if (!context.conditions?.moving) return () => { button.disabled = false; };
    const avatar = button.querySelector("img")!;
    let active = true, started = false;
    const salute = gsap.timeline({ paused: true }).to(avatar, { rotation: -9, y: -4, duration: .14, ease: "power2.out" })
      .to(avatar, { rotation: 7, y: -2, duration: .2, ease: "power1.inOut" })
      .to(avatar, { rotation: 0, y: 0, duration: .35, ease: "power2.out" });
    const greet = () => { if (active) { started = true; salute.restart(); } };
    const stopPlayback = observePlayback(root, value => { active = value; if (!active) salute.pause(); else if (started && salute.progress() < 1) salute.play(); });
    button.addEventListener("pointerenter", greet); button.addEventListener("focus", greet); button.addEventListener("click", greet);
    return () => { stopPlayback(); button.removeEventListener("pointerenter", greet); button.removeEventListener("focus", greet); button.removeEventListener("click", greet); };
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
      path.style.strokeDashoffset = String(length * (1 - progress.value));
      light.setAttribute("transform", `translate(${point.x} ${point.y})`);
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
