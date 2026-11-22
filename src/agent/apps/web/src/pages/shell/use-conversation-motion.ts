import { useLayoutEffect, useRef } from "react";

/** Animate presentation only: never defer navigation, cached history or subscriptions. */
export function useConversationMotion(identity: string, animateOnMount: boolean) {
  const element = useRef<HTMLElement>(null);
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    const changed = previous.current !== null && previous.current !== identity;
    const entering = previous.current === null && animateOnMount;
    previous.current = identity;
    if ((!changed && !entering) || !element.current?.animate ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const direction = document.documentElement.dir === "rtl" ? -1 : 1;
    const animation = element.current.animate([
      { opacity: 0.85, transform: `translateX(${direction * 10}px)` },
      { opacity: 1, transform: "translateX(0)" },
    ], { duration: 160, easing: "cubic-bezier(.16,1,.3,1)" });
    return () => animation.cancel();
  }, [identity, animateOnMount]);
  return element;
}
