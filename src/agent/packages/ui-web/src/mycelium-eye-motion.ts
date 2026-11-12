import { avatarIdentitySeed, myceliumEyeFrame } from "@rakazo/core";
import { useEffect, useRef, type RefObject } from "react";

// One capped clock for all visible characters. Frames only update SVG attributes;
// they never cause a React render or change the body, selected shape or color.
const listeners = new Set<(seconds: number) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let animation: number | undefined;
function stop() {
  if (timer !== undefined) clearTimeout(timer);
  if (animation !== undefined) cancelAnimationFrame(animation);
  timer = undefined;
  animation = undefined;
}
function start() {
  if (!listeners.size || document.hidden || timer !== undefined || animation !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    animation = requestAnimationFrame((now) => {
      animation = undefined;
      for (const paint of listeners) paint(now / 1000);
      start();
    });
  }, 1000 / 30);
}
function subscribe(paint: (seconds: number) => void) {
  listeners.add(paint);
  start();
  return () => {
    listeners.delete(paint);
    if (!listeners.size) stop();
  };
}

export function useMyceliumEyes(
  root: RefObject<SVGSVGElement | null>, enabled: boolean, status: string | undefined, identity: string,
) {
  const previous = useRef({ x: 0, y: 0, roll: 0 });
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) return;
    const gaze = element.querySelector<SVGGElement>("[data-mycelium-gaze]");
    const lids = element.querySelectorAll<SVGElement>("[data-mycelium-lid]");
    if (!gaze) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const group = element.closest("[data-avatar-hover],button,a,[role=button],[role=menuitem]") ?? element;
    const phase = (avatarIdentitySeed(identity) % 10000) / 173;
    let visible = typeof IntersectionObserver === "undefined";
    let focused = document.hasFocus();
    let hover = false;
    let remove: (() => void) | undefined;
    function paint(t: number) {
      const frame = myceliumEyeFrame(t, status, phase, hover);
      const p = previous.current;
      p.x += (frame.x - p.x) * 0.22;
      p.y += (frame.y - p.y) * 0.22;
      p.roll += (frame.roll - p.roll) * 0.22;
      gaze!.setAttribute("transform", `translate(${p.x.toFixed(3)} ${p.y.toFixed(3)}) rotate(${p.roll.toFixed(3)} 32 40)`);
      lids.forEach((lid, i) => {
        const open = i === 0 ? frame.leftLid ?? frame.lid : frame.lid;
        const inset = ((1 - open) * 48).toFixed(2);
        lid.style.clipPath = `inset(${inset}% 0 ${inset}% 0 round 2px)`;
      });
      element!.setAttribute("data-mico-mood", frame.mood);
      element!.setAttribute("data-mico-eye-frame", t.toFixed(2));
    }
    function sync() {
      const active = visible && focused && !document.hidden && !media.matches;
      element!.setAttribute("data-mico-eye-motion", active ? "active" : "paused");
      if (active && !remove) remove = subscribe(paint);
      if (!active && remove) { remove(); remove = undefined; }
      if (media.matches) {
        gaze!.removeAttribute("transform");
        lids.forEach(lid => { lid.style.clipPath = "none"; });
      }
    }
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      sync();
    });
    observer?.observe(element);
    const focus = () => { focused = true; sync(); };
    const blur = () => { focused = false; sync(); };
    const enter = () => { hover = true; };
    const leave = () => { hover = false; };
    window.addEventListener("focus", focus);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    group.addEventListener("pointerenter", enter);
    group.addEventListener("pointerleave", leave);
    group.addEventListener("focusin", enter);
    group.addEventListener("focusout", leave);
    sync();
    return () => {
      remove?.(); observer?.disconnect();
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
      group.removeEventListener("pointerenter", enter);
      group.removeEventListener("pointerleave", leave);
      group.removeEventListener("focusin", enter);
      group.removeEventListener("focusout", leave);
    };
  }, [root, enabled, status, identity]);
}
