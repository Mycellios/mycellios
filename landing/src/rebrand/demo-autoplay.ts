export interface DemoAutoplayOptions {
  steps?: number;
  duration?: number | readonly number[];
}

/** Tour illustrative states only while visible. Real input always gets time to finish. */
export function createDemoAutoplay(root: HTMLElement, onStep: (step: number) => void, { steps = 1, duration = 6000 }: DemoAutoplayOptions = {}) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const page = root.closest<HTMLElement>("[data-journey-running]");
  const stories = root.closest<HTMLElement>("[data-stories-paused]");
  let visible = false, timer: number | undefined, previous = 0, elapsed = 0, step = 0, blockedUntil = 0;
  const tick = () => {
    const now = performance.now(), delta = now - previous;
    previous = now;
    const focused = document.activeElement;
    if (now < blockedUntil || focused && root.contains(focused) && focused.matches("input,textarea,select,[contenteditable='true']")) { elapsed = 0; return; }
    elapsed += delta;
    const wait = typeof duration === "number" ? duration : duration[step] ?? 6000;
    if (elapsed < wait) return;
    elapsed = 0; step = (step + 1) % steps; onStep(step);
  };
  const synchronize = () => {
    const enabled = visible && !document.hidden && !media.matches && page?.dataset.journeyRunning !== "false"
      && stories?.dataset.storiesPaused !== "true" && root.dataset.storyPaused !== "true";
    if (enabled && timer === undefined) { previous = performance.now(); timer = window.setInterval(tick, 250); }
    else if (!enabled && timer !== undefined) { window.clearInterval(timer); timer = undefined; }
  };
  const hold = () => { blockedUntil = performance.now() + 12000; elapsed = 0; };
  const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); synchronize(); }, { threshold: .15 });
  observer.observe(root);
  const mutations = new MutationObserver(synchronize);
  for (const element of [root, page, stories]) if (element) mutations.observe(element, { attributes: true, attributeFilter: ["data-journey-running", "data-stories-paused", "data-story-paused"] });
  root.addEventListener("pointerdown", hold); root.addEventListener("keydown", hold);
  media.addEventListener("change", synchronize); document.addEventListener("visibilitychange", synchronize);
  return { destroy() {
    window.clearInterval(timer); observer.disconnect(); mutations.disconnect();
    root.removeEventListener("pointerdown", hold); root.removeEventListener("keydown", hold);
    media.removeEventListener("change", synchronize); document.removeEventListener("visibilitychange", synchronize);
  } };
}
