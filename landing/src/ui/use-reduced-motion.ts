import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";
const snapshot = () => typeof window !== "undefined" && (window.matchMedia?.(query).matches ?? false);
const serverSnapshot = () => false;
function subscribe(notify: () => void) {
  const media = window.matchMedia?.(query);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}

/** Keep canvas effects in sync with live OS preferences as well as CSS effects. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
