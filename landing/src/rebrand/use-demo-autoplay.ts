import { useEffect, useRef, type RefObject } from "react";

export function useDemoAutoplay(root: RefObject<HTMLElement | null>, onStep: (step: number) => void, steps: number, duration: number | readonly number[] = 6000) {
  const callback = useRef(onStep);
  useEffect(() => { callback.current = onStep; }, [onStep]);
  useEffect(() => {
    let active = true, destroy: (() => void) | undefined;
    void import("./demo-autoplay").then(({ createDemoAutoplay }) => {
      if (active && root.current) destroy = createDemoAutoplay(root.current, step => callback.current(step), { steps, duration }).destroy;
    }).catch(() => {});
    return () => { active = false; destroy?.(); };
  }, [root, steps, duration]);
}
