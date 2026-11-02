import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { createPortal } from "react-dom";
import { Pause, Play } from "lucide-react";
import { IconButton } from "../ui/primitives";
import { createSignalClock, pointOnSamples } from "./living-network-model";
import { AgentTailBackdrop } from "./AgentTailBackdrop";

/** The network wakes on arrival, stays alive in view, and re-arms after leaving. */
export default function AgentClosingScene({ section, tail }: { section: HTMLElement; tail: HTMLElement }) {
  const root = useRef<SVGSVGElement>(null);
  const paused = useRef(false), synchronizeMotion = useRef(() => {});
  const [isPaused, setPaused] = useState(false), [pagePlaying, setPagePlaying] = useState(true);
  useEffect(() => {
    if (!root.current) return;
    const owner = section.closest<HTMLElement>("[data-journey-running]");
    const media = gsap.matchMedia(section);
    media.add("(prefers-reduced-motion: no-preference)", () => {
      let inView = false, armed = true, started = false, elapsed = 0, cycleStart = 0;
      section.dataset.closingState = "waiting";
      const timeline = gsap.timeline({ paused: true });
      const routes = [...root.current!.querySelectorAll<SVGGElement>(".agent-closing-root")].map((group, index) => {
        const path = group.querySelector<SVGPathElement>(".agent-closing-live")!, light = group.querySelector<SVGGElement>(".agent-closing-signal")!;
        const route = { path, light, length: path.getTotalLength(), samples: [{ x: 0, y: 0 }], progress: { value: 0 } };
        const { length } = route;
        route.samples = Array.from({ length: 61 }, (_, sample) => { const point = path.getPointAtLength(length * sample / 60); return { x: point.x, y: point.y }; });
        path.style.strokeDasharray = String(length);
        path.style.strokeDashoffset = String(length);
        timeline.to(route.progress, { value: 1, duration: 2.35, ease: "power1.inOut", onUpdate: () => { path.style.strokeDashoffset = String(route.length * (1 - route.progress.value)); } }, index * .09);
        return route;
      });
      timeline.fromTo(section.querySelector(".agent-closing-emblem img"), { opacity: .35, scale: .94 }, { opacity: 1, scale: 1, duration: .85, ease: "power2.out" }, 1.55);
      // Geometry is sampled again on layout changes, never on animation frames.
      const geometry = new MutationObserver(() => routes.forEach(route => {
        route.length = route.path.getTotalLength();
        route.samples = Array.from({ length: 61 }, (_, sample) => { const point = route.path.getPointAtLength(route.length * sample / 60); return { x: point.x, y: point.y }; });
        route.path.style.strokeDasharray = String(route.length);
        route.path.style.strokeDashoffset = String(route.length * (1 - route.progress.value));
      }));
      geometry.observe(root.current!, { subtree: true, attributes: true, attributeFilter: ["d"] });
      const clock = createSignalClock(gsap.ticker, time => {
        elapsed = time;
        const sceneTime = Math.max(0, elapsed - cycleStart), awake = sceneTime >= timeline.duration();
        timeline.time(Math.min(timeline.duration(), sceneTime), false);
        section.dataset.closingState = awake ? "awake" : "charging";
        routes.forEach((route, index) => {
          const phase = awake ? ((sceneTime - timeline.duration()) / (7 + index * .65) + index * .13) % 1 : route.progress.value;
          const point = pointOnSamples(route.samples, phase);
          route.light.setAttribute("transform", `translate(${point.x} ${point.y})`);
          route.light.setAttribute("opacity", String(Math.min(1, phase / .06, (1 - phase) / .06)));
        });
      });
      const synchronize = () => {
        const pageActive = owner?.dataset.journeyRunning !== "false";
        setPagePlaying(pageActive);
        clock.setActive(started && inView && !paused.current && !document.hidden && pageActive);
      };
      synchronizeMotion.current = synchronize;
      const reset = () => {
        armed = true; started = false; timeline.time(0, true);
        section.dataset.closingState = "waiting";
        routes.forEach(route => { route.path.style.strokeDashoffset = route.path.style.strokeDasharray; route.light.setAttribute("opacity", "0"); });
      };
      const emblem = section.querySelector(".agent-closing-emblem")!;
      const viewport = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.target === section) { inView = entry.isIntersecting; if (!inView) reset(); }
          if (entry.target === emblem && entry.intersectionRatio >= .75 && armed) { armed = false; started = true; cycleStart = elapsed; }
        });
        synchronize();
      }, { threshold: [0, .75] });
      viewport.observe(section); viewport.observe(emblem);
      const playback = new MutationObserver(synchronize);
      if (owner) playback.observe(owner, { attributes: true, attributeFilter: ["data-journey-running"] });
      document.addEventListener("visibilitychange", synchronize);
      synchronize();
      return () => {
        clock.destroy(); viewport.disconnect(); playback.disconnect(); geometry.disconnect(); document.removeEventListener("visibilitychange", synchronize);
        synchronizeMotion.current = () => {};
        routes.forEach(route => { route.path.style.removeProperty("stroke-dasharray"); route.path.style.removeProperty("stroke-dashoffset"); route.light.setAttribute("opacity", "0"); route.light.removeAttribute("transform"); });
        delete section.dataset.closingState;
      };
    });
    return () => media.revert();
  }, [section]);
  return <><AgentTailBackdrop tail={tail} section={section} paused={isPaused} root={root} />{createPortal(<IconButton className="agent-closing-motion" variant="ghost" disabled={!pagePlaying} aria-label={!pagePlaying ? "Page animations paused" : isPaused ? "Play mycelium animation" : "Pause mycelium animation"} onClick={() => { paused.current = !paused.current; setPaused(paused.current); synchronizeMotion.current(); }}>{isPaused ? <Play size={16} /> : <Pause size={16} />}</IconButton>, section)}</>;
}
