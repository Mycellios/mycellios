import gsap from "gsap";
import { createTimelineClock } from "./timeline-clock";
import { connectProductDiagrams } from "./diagram-motion";

/** Keep text readable while each example builds, and leave complete connections intact. */
export function animateProductStory(root: HTMLElement) {
  if (typeof IntersectionObserver === "undefined") return () => {};
  const diagram = connectProductDiagrams(root);
  diagram?.settle();
  const media = gsap.matchMedia(root);
  media.add("(prefers-reduced-motion: reduce)", () => { diagram?.settle(); });
  media.add("(prefers-reduced-motion: no-preference)", () => {
    let inView = false, permitted = true;
    const page = root.closest<HTMLElement>("[data-journey-running]");
    const stories = root.closest<HTMLElement>("[data-stories-paused]");
    const sequence = gsap.timeline({ paused: true, defaults: { ease: "power3.out", duration: .4 } });
    const loop = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 1.6, defaults: { ease: "power3.out", duration: .4 } });
    let stopRoutine: (() => void) | undefined;
    const headingParts = root.querySelectorAll("[data-story-enter] h2, [data-story-enter] > p, [data-story-enter] > a");
    if (headingParts.length) sequence.from(headingParts, { y: 16, stagger: .06, duration: .8 });
    const stages = root.querySelectorAll("[data-story-stage]");
    if (stages.length) sequence.from(stages, { y: 20, opacity: .7, duration: .8 }, .2);

    diagram?.animate(loop);
    if (root.classList.contains("story-model")) {
      sequence.from(root.querySelectorAll(".model-patchbay-sources > button, .model-patchbay-project"), { opacity: .6, stagger: .06 }, .4);
    }

    if (root.classList.contains("story-browser")) {
      loop.repeatDelay(5);
      const cursor = root.querySelector(".story-preview-cursor"), frame = root.querySelector(".story-selection-frame");
      loop.fromTo(cursor, { x: 24, y: 18, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: .8, ease: "power2.inOut" }, .6)
        .to(cursor, { scale: .97, duration: .2 }, 1.4).to(cursor, { scale: 1, duration: .2 }, 1.6)
        .fromTo(frame, { opacity: 0 }, { opacity: 1, duration: .4 }, 1.8)
        .to([cursor, frame], { opacity: 0, duration: .4 }, 4);
    }

    if (root.classList.contains("story-routines")) {
      sequence.from(root.querySelectorAll(".routine-timeline-days > div"), { opacity: .6, stagger: .06 }, .4);
      const runner = root.querySelector<HTMLElement>("[data-routine-runner]")!;
      const progress = { value: 0 }, setX = gsap.quickSetter(runner, "x", "px");
      let distance = Math.max(0, runner.parentElement!.clientWidth - 8);
      const paint = () => setX(progress.value * distance);
      const resize = new ResizeObserver(() => { distance = Math.max(0, runner.parentElement!.clientWidth - 8); paint(); });
      resize.observe(runner.parentElement!);
      stopRoutine = () => { resize.disconnect(); runner.style.removeProperty("transform"); };
      loop.fromTo(progress, { value: 0 }, { value: 1, duration: 1.6, ease: "power2.inOut", onUpdate: paint }, .4)
        .fromTo(root.querySelector("[data-routine-check]"), { opacity: .3 }, { opacity: 1, duration: .4 }, 2);

    }

    if (root.classList.contains("story-context")) {
      sequence.from(root.querySelectorAll(".context-access dl > div"), { y: 8, opacity: .6, stagger: .06 }, .2)
        .from(root.querySelector(".story-permission-example"), { y: 8, opacity: .6 }, .6);
    }

    if (root.classList.contains("story-start")) {
      sequence.from(root.querySelectorAll(".story-start-steps > a, .story-start-steps > button"), { opacity: .6, stagger: .06 }, .4);
    }

    const synchronize = () => {
      const userPaused = root.dataset.storyPaused === "true" || stories?.dataset.storiesPaused === "true" || page?.dataset.journeyRunning === "false";
      permitted = !document.hidden && !userPaused;
      if (userPaused) {
        sequence.progress(1);
        if (loop.duration()) loop.time(loop.labels["settled"] ?? loop.duration());
        diagram?.settle();
      }
      if (loop.duration()) {
        if (inView && permitted && loop.progress() === 1) loop.restart();
        loop.paused(!(inView && permitted));
      }
      root.dataset.storyRunning = String(inView && permitted);
    };
    const clock = createTimelineClock(sequence, gsap.ticker, () => inView && permitted);
    const observer = new IntersectionObserver(entries => {
      inView = entries.some(entry => entry.isIntersecting);
      clock.reset(); synchronize();
    }, { threshold: .12 });
    observer.observe(root.querySelector(".story-network, [data-story-stage]") ?? root);
    const mutations = new MutationObserver(synchronize);
    mutations.observe(root, { attributes: true, attributeFilter: ["data-story-paused"] });
    if (page) mutations.observe(page, { attributes: true, attributeFilter: ["data-journey-running"] });
    if (stories) mutations.observe(stories, { attributes: true, attributeFilter: ["data-stories-paused"] });
    document.addEventListener("visibilitychange", synchronize);
    synchronize();
    return () => {
      observer.disconnect(); mutations.disconnect(); clock.destroy();
      document.removeEventListener("visibilitychange", synchronize);
      sequence.kill(); loop.kill(); stopRoutine?.(); delete root.dataset.storyRunning;
    };
  });
  return () => { media.revert(); diagram?.destroy(); };
}
