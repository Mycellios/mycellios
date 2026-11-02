import gsap from "gsap";
import { createForestRenderer, type ForestPictures } from "./forest-renderer";

const sessionKey = "mycellios.forestIntro.v1";

/** The HTML bootstrap owns unlocking the page, even when this chunk fails. */
export function startForestLoader(loader: HTMLElement) {
  loader.dataset.claimed = "true";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  loader.prepend(canvas);
  const state = { growth: 0, leaving: 0 };
  let renderer: ReturnType<typeof createForestRenderer> | undefined;
  let growth: gsap.core.Timeline | undefined;
  let exit: gsap.core.Tween | undefined;
  let signaled = false, ready = false, complete = false, skipped = false, failed = false, disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) callback(); }, delay);
    timers.add(timer);
  };
  const finish = (remember: boolean) => {
    if (disposed) return;
    if (remember) { try { sessionStorage.setItem(sessionKey, "seen"); } catch { /* Optional session preference. */ } }
    loader.dispatchEvent(new Event("mycellios:forest-finish"));
  };
  const advance = () => {
    if (!ready || disposed || exit) return;
    if (failed) { finish(false); return; }
    if (skipped) { finish(true); return; }
    if (!complete || !renderer) return;
    exit = gsap.to(state, { leaving: 1, duration: .8, ease: "power2.inOut",
      onUpdate: () => renderer?.render(state), onComplete: () => finish(true) });
  };
  const routeReady = () => {
    if (signaled || disposed) return;
    signaled = true;
    // Fonts may settle later on a slow network; they cannot hold the intro forever.
    const painted = () => { if (!disposed) { ready = true; growth?.timeScale(1.25); advance(); } };
    void Promise.race([document.fonts.ready, new Promise<void>(resolve => later(resolve, 600))]).then(painted);
    later(() => { if (!renderer && !skipped) { failed = true; advance(); } }, 1800);
  };
  const skip = () => { skipped = true; advance(); };
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") skip(); };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const onMotion = () => { if (motion.matches) skip(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    growth?.kill(); exit?.kill(); renderer?.destroy();
    timers.forEach(clearTimeout); timers.clear();
    loader.removeEventListener("mycellios:route-ready", routeReady);
    loader.removeEventListener("mycellios:forest-skip", skip);
    loader.removeEventListener("mycellios:loader-released", dispose);
    window.removeEventListener("keydown", onKey);
    motion.removeEventListener("change", onMotion);
  };
  loader.addEventListener("mycellios:route-ready", routeReady);
  loader.addEventListener("mycellios:forest-skip", skip);
  loader.addEventListener("mycellios:loader-released", dispose);
  window.addEventListener("keydown", onKey);
  motion.addEventListener("change", onMotion);
  if (loader.dataset.routeReady) routeReady();
  onMotion();

  const portrait = matchMedia("(orientation: portrait)").matches;
  const prefix = `/assets/loading/forest-${portrait ? "portrait-" : ""}`;
  void Promise.all([`${prefix}clean-v1.webp`, `${prefix}grown-v1.webp`, "/assets/landing/network-fruiting.webp"].map(async (source, index) => {
    const image = new Image(); image.fetchPriority = index === 0 ? "high" : "low";
    image.src = source; await image.decode(); return image;
  })).then(images => {
    if (disposed || failed || skipped) return;
    renderer = createForestRenderer(canvas, images as unknown as ForestPictures, () => {
      const rect = document.querySelector(".reference-network-print")?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    });
    renderer.render(state);
    loader.dataset.animated = "true";
    growth = gsap.timeline({ onUpdate: () => renderer?.render(state),
      onComplete: () => { complete = true; advance(); } });
    growth.addLabel("colonize", .2).to(state, { growth: 1, duration: 3.4, ease: "none" }, "colonize")
      .addLabel("settle").to({}, { duration: .25 }, "settle");
    if (ready) growth.timeScale(1.25);
  }).catch(() => { failed = true; advance(); });
  later(() => { if (!renderer) { failed = true; advance(); } }, 3000);
  return dispose;
}
