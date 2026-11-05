import gsap from "gsap";
import { createTimelineClock } from "./timeline-clock";
import { createDemoAutoplay } from "./demo-autoplay";
import { animateLivingNetwork } from "./living-network-motion";
import { animateMicoGreeting } from "./agent-journey-motion";
export { animateCasePreview, animateNetworkThread } from "./agent-journey-motion";

export function animateAgentHero(root: HTMLElement) {
  const stopBackdrop = animateLivingNetwork(root);
  const stopGreeting = animateMicoGreeting(root);
  const media = gsap.matchMedia(root);
  media.add("(prefers-reduced-motion: no-preference)", () => {
    const timeline = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
    timeline.from("[data-hero-enter]", { y: 8, duration: .6, stagger: .06 }, 0)
      .from("[data-hero-window]", { opacity: .7, y: 24, scale: .99, duration: .8 }, .2);
    const clock = createTimelineClock(timeline, gsap.ticker);
    return () => clock.destroy();
  });
  return () => { stopBackdrop(); stopGreeting(); media.revert(); };
}

export function animateAgentDemo(root: HTMLElement, request: string, onComplete: () => void, onApproved: () => void, onNext: () => void) {
  const media = gsap.matchMedia(root);
  const scroller = root.querySelector<HTMLElement>(".agent-demo-transcript")!;
  const steps = [...root.querySelectorAll<HTMLElement>(".agent-demo-step")];
  const cursor = root.querySelector<HTMLElement>(".agent-demo-cursor")!;
  const draft = root.querySelector<HTMLElement>(".agent-demo-draft")!;
  const declined = root.querySelector<HTMLElement>(".agent-demo-declined")!;
  let timeline: gsap.core.Timeline | null = null;
  let clock: ReturnType<typeof createTimelineClock> | null = null;
  let userPaused = false, inView = true, reducedSeen = false;
  const synchronize = () => {
    clock?.reset();
  };
  media.add({ reduced: "(prefers-reduced-motion: reduce)", moving: "(prefers-reduced-motion: no-preference)" }, context => {
    scroller.scrollTop = 0;
    declined.hidden = true;
    draft.textContent = "";
    gsap.set(cursor, { autoAlpha: 0, scale: 1 });
    if (context.conditions?.reduced || reducedSeen) {
      reducedSeen = true;
      gsap.set(steps, { display: "block", autoAlpha: 1 });
      scroller.scrollTop = scroller.scrollHeight;
      onApproved();
      return;
    }
    gsap.set(steps, { display: "none" });
    const typing = { count: 0 };
    const tl = gsap.timeline({ paused: true, onComplete });
    timeline = tl;
    tl.addLabel("typing", .2).to(typing, { count: request.length, duration: 1.25, ease: "none",
      onUpdate: () => { draft.textContent = request.slice(0, Math.round(typing.count)); } }, "typing")
      .addLabel("submitted", 1.7).call(() => { draft.textContent = ""; }, [], "submitted");
    const arrivals = [1.7, 2.5, 3.2, 4.1, 6.5, 7.4, 8.5];
    steps.forEach((step, index) => {
      const time = arrivals[index]!;
      tl.set(step, { display: "block" }, time)
        .fromTo(step, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: .4, ease: "power3.out", immediateRender: false }, time)
        .to(scroller, { scrollTop: () => Math.max(0, scroller.scrollHeight - scroller.clientHeight), duration: .4, ease: "power2.inOut" }, time + .05);
    });
    const relativePoint = () => {
      const bounds = root.querySelector(".agent-demo-window")!.getBoundingClientRect();
      const button = root.querySelector(".agent-demo-allow")!.getBoundingClientRect();
      return { x: button.x - bounds.x + button.width * .55, y: button.y - bounds.y + button.height * .55 };
    };
    tl.set(cursor, { autoAlpha: 1, x: () => root.clientWidth * .7, y: 230 }, 5)
      .to(cursor, { x: () => relativePoint().x, y: () => relativePoint().y, duration: .7, ease: "power2.inOut" }, 5.2)
      .to(cursor, { scale: .97, duration: .2 }, 6).to(cursor, { scale: 1, duration: .2 }, 6.2)
      .to(cursor, { autoAlpha: 0, duration: .2 }, 6.3)
      .addLabel("approved", 6.5).call(onApproved, [], "approved")
      .fromTo(root.querySelectorAll(".agent-demo-result li"), { x: 6, opacity: 0 }, { x: 0, opacity: 1, stagger: .06, duration: .4, ease: "power3.out", immediateRender: false }, 7.5)
      .addLabel("complete", 10.8).to({}, { duration: .7 }, "complete");
    clock = createTimelineClock(tl, gsap.ticker, () => !userPaused && inView && !document.hidden);
    synchronize();
    return () => { clock?.destroy(); clock = null; tl.kill(); timeline = null; declined.hidden = true; draft.textContent = ""; };
  });
  const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; synchronize(); }, { threshold: .08 });
  observer.observe(root);
  const autoplay = createDemoAutoplay(root, onNext, { duration: 15000 });
  document.addEventListener("visibilitychange", synchronize);
  return {
    pause() { userPaused = true; synchronize(); gsap.set(cursor, { autoAlpha: 0 }); },
    play() { userPaused = false; synchronize(); },
    approve() { userPaused = true; timeline?.pause().progress(1, true); clock?.destroy(); onApproved(); },
    decline() {
      userPaused = true; timeline?.pause(); clock?.destroy(); gsap.set(cursor, { autoAlpha: 0 });
      gsap.set(steps.slice(4), { display: "none" }); declined.hidden = false;
      scroller.scrollTop = scroller.scrollHeight;
    },
    destroy() { observer.disconnect(); autoplay.destroy(); document.removeEventListener("visibilitychange", synchronize); media.revert(); },
  };
}
