import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Optional scroll choreography for the home page. Every element is fully visible
 * without it; this module only hides content it is about to reveal, and it does
 * nothing when the visitor prefers reduced motion.
 */
export function animateHome(root: HTMLElement): () => void {
  const media = gsap.matchMedia();
  media.add("(prefers-reduced-motion: no-preference)", () => {
    const stage = root.querySelector<HTMLElement>("[data-home-stage]");
    if (stage) {
      gsap.fromTo(stage, { rotateX: 14, scale: .94, y: 24 }, {
        rotateX: 0, scale: 1, y: 0, ease: "none",
        scrollTrigger: { trigger: stage, start: "top 92%", end: "top 28%", scrub: .6 },
      });
    }

    const reveals = gsap.utils.toArray<HTMLElement>("[data-reveal]", root);
    gsap.set(reveals, { autoAlpha: 0, y: 28 });
    ScrollTrigger.batch(reveals, {
      start: "top 88%",
      once: true,
      onEnter: batch => gsap.to(batch, { autoAlpha: 1, y: 0, duration: .8, ease: "power3.out", stagger: .08, overwrite: true }),
    });

    for (const rail of gsap.utils.toArray<HTMLElement>("[data-home-rail]", root)) {
      gsap.fromTo(rail, { scaleX: 0 }, {
        scaleX: 1, ease: "none", transformOrigin: "0 50%",
        scrollTrigger: { trigger: rail.parentElement, start: "top 75%", end: "bottom 60%", scrub: .5 },
      });
    }

    for (const band of gsap.utils.toArray<HTMLElement>("[data-home-band]", root)) {
      gsap.fromTo(band, { clipPath: "inset(4% 3% 0% 3% round 40px)" }, {
        clipPath: "inset(0% 0% 0% 0% round 32px)", ease: "none",
        scrollTrigger: { trigger: band, start: "top 95%", end: "top 30%", scrub: .5 },
      });
    }

    const giant = root.querySelector<HTMLElement>("[data-home-giant]");
    if (giant) {
      gsap.fromTo(giant, { backgroundPosition: "0% 30%", scale: .9 }, {
        backgroundPosition: "100% 70%", scale: 1, ease: "none",
        scrollTrigger: { trigger: giant, start: "top bottom", end: "bottom top", scrub: .6 },
      });
    }

    // Manifesto: each word lights up as the paragraph crosses the viewport.
    const manifesto = root.querySelector<HTMLElement>("[data-home-manifesto]");
    if (manifesto) {
      const words = manifesto.querySelectorAll<HTMLElement>(":scope > span");
      gsap.fromTo(words, { opacity: .14 }, {
        opacity: 1, ease: "none", stagger: .1,
        scrollTrigger: { trigger: manifesto, start: "top 80%", end: "bottom 45%", scrub: .4 },
      });
    }

    // Stacking cards: each card settles back while the next one covers it.
    const cards = gsap.utils.toArray<HTMLElement>("[data-home-stack]", root);
    cards.forEach((card, index) => {
      const next = cards[index + 1];
      if (!next) return;
      gsap.to(card, {
        scale: .93 - (cards.length - index - 2) * .02, filter: "brightness(.97)", ease: "none", transformOrigin: "50% 0",
        scrollTrigger: { trigger: next, start: "top 85%", end: "top 25%", scrub: .4 },
      });
    });

    const art = root.querySelector<HTMLElement>(".home-hero-art");
    if (art) {
      gsap.to(art, { yPercent: -8, ease: "none", scrollTrigger: { trigger: art, start: "top 70%", end: "bottom top", scrub: .6 } });
    }
  });
  // Pointer-only polish: tilted bento cards and magnetic calls to action.
  media.add("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)", () => {
    const cleanups: Array<() => void> = [];
    for (const card of gsap.utils.toArray<HTMLElement>(".home-card", root)) {
      const rotateX = gsap.quickTo(card, "rotationX", { duration: .5, ease: "power3.out" });
      const rotateY = gsap.quickTo(card, "rotationY", { duration: .5, ease: "power3.out" });
      gsap.set(card, { transformPerspective: 900 });
      const move = (event: PointerEvent) => {
        const rect = card.getBoundingClientRect();
        rotateY(((event.clientX - rect.left) / rect.width - .5) * 7);
        rotateX(-((event.clientY - rect.top) / rect.height - .5) * 7);
      };
      const leave = () => { rotateX(0); rotateY(0); };
      card.addEventListener("pointermove", move);
      card.addEventListener("pointerleave", leave);
      cleanups.push(() => { card.removeEventListener("pointermove", move); card.removeEventListener("pointerleave", leave); });
    }
    for (const target of gsap.utils.toArray<HTMLElement>(".home .agent-product-actions > *, .home-band-actions > .ui-link[data-variant]", root)) {
      const x = gsap.quickTo(target, "x", { duration: .4, ease: "power3.out" });
      const y = gsap.quickTo(target, "y", { duration: .4, ease: "power3.out" });
      const move = (event: PointerEvent) => {
        const rect = target.getBoundingClientRect();
        x((event.clientX - rect.left - rect.width / 2) * .18);
        y((event.clientY - rect.top - rect.height / 2) * .3);
      };
      const leave = () => { x(0); y(0); };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerleave", leave);
      cleanups.push(() => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerleave", leave); });
    }
    return () => cleanups.forEach(cleanup => cleanup());
  });
  // Lazy images and the demo change heights after the first layout.
  const refresh = window.setTimeout(() => ScrollTrigger.refresh(), 1200);
  return () => { window.clearTimeout(refresh); media.revert(); };
}
