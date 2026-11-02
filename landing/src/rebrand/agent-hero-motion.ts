import gsap from "gsap";
import { createTimelineClock } from "./timeline-clock";
import { animateLivingNetwork } from "./living-network-motion";
import { animateMicoGreeting } from "./agent-journey-motion";
export { animateCasePreview, animateNetworkThread } from "./agent-journey-motion";

export function animateAgentHero(root: HTMLElement) {
  const stopBackdrop = animateLivingNetwork(root);
  const stopGreeting = animateMicoGreeting(root);
  const media = gsap.matchMedia(root);
  media.add("(prefers-reduced-motion: no-preference)", () => {
    const timeline = gsap.timeline({ paused: true, defaults: { ease: "power2.out" } });
    timeline.from("[data-hero-enter]", { autoAlpha: 0, y: 14, duration: .65, stagger: .1 }, .2)
      .from("[data-hero-window]", { autoAlpha: 0, y: 48, scale: .97, duration: 1 }, "<.3");
    const clock = createTimelineClock(timeline, gsap.ticker);
    return () => clock.destroy();
  });
  return () => { stopBackdrop(); stopGreeting(); media.revert(); };
}

export function animateAgentDemo(root: HTMLElement, request: string, onComplete: () => void, onApproved: () => void) {
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
      onApproved(); onComplete();
      return;
    }
    gsap.set(steps, { display: "none" });
    const typing = { count: 0 };
    const tl = gsap.timeline({ paused: true, onComplete });
    timeline = tl;
    tl.addLabel("typing", .5).to(typing, { count: request.length, duration: 1.65, ease: "none",
      onUpdate: () => { draft.textContent = request.slice(0, Math.round(typing.count)); } }, "typing")
      .addLabel("submitted", 2.4).call(() => { draft.textContent = ""; }, [], "submitted");
    const arrivals = [2.4, 3.4, 4.5, 5.5, 8.4, 9.5, 10.5];
    steps.forEach((step, index) => {
      const time = arrivals[index]!;
      tl.set(step, { display: "block" }, time)
        .fromTo(step, { autoAlpha: 0, y: 9 }, { autoAlpha: 1, y: 0, duration: .35, ease: "power1.out", immediateRender: false }, time)
        .to(scroller, { scrollTop: () => Math.max(0, scroller.scrollHeight - scroller.clientHeight), duration: .4, ease: "power1.inOut" }, time + .05);
    });
    const relativePoint = () => {
      const bounds = root.querySelector(".agent-demo-window")!.getBoundingClientRect();
      const button = root.querySelector(".agent-demo-allow")!.getBoundingClientRect();
      return { x: button.x - bounds.x + button.width * .55, y: button.y - bounds.y + button.height * .55 };
    };
    tl.set(cursor, { autoAlpha: 1, x: () => root.clientWidth * .7, y: 230 }, 6.7)
      .to(cursor, { x: () => relativePoint().x, y: () => relativePoint().y, duration: .7, ease: "power2.inOut" }, 7)
      .to(cursor, { scale: .8, duration: .12 }, 7.9).to(cursor, { scale: 1, duration: .15 }, 8.02)
      .to(cursor, { autoAlpha: 0, duration: .2 }, 8.3)
      .addLabel("approved", 8.4).call(onApproved, [], "approved")
      .addLabel("complete", 13).to({}, { duration: 1 }, "complete");
    clock = createTimelineClock(tl, gsap.ticker, () => !userPaused && inView);
    synchronize();
    return () => { clock?.destroy(); clock = null; tl.kill(); timeline = null; declined.hidden = true; draft.textContent = ""; };
  });
  const observer = new IntersectionObserver(entries => { inView = entries[0]?.isIntersecting ?? false; synchronize(); }, { threshold: .08 });
  observer.observe(root);
  return {
    pause() { userPaused = true; synchronize(); gsap.set(cursor, { autoAlpha: 0 }); },
    play() { userPaused = false; synchronize(); },
    approve() { userPaused = true; timeline?.pause().progress(1, true); clock?.destroy(); onApproved(); onComplete(); },
    decline() {
      userPaused = true; timeline?.pause(); clock?.destroy(); gsap.set(cursor, { autoAlpha: 0 });
      gsap.set(steps.slice(4), { display: "none" }); declined.hidden = false;
      scroller.scrollTop = scroller.scrollHeight; onComplete();
    },
    destroy() { observer.disconnect(); media.revert(); },
  };
}
