import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { NavigateFunction, NavigateOptions, To } from "react-router-dom";

/**
 * Switching spaces in place: the shell is keyed by this counter, so a switch
 * throws away every piece of the previous space's state, as a reload would,
 * without reloading the page.
 */
let epoch = 0;
const listeners = new Set<() => void>();
/** Resolves the transition currently waiting for the new shell, if any. */
let shellReady: (() => void) | null = null;
let activeTransitions = 0;

/** The longest the old screen is held while the new space's shell renders. */
const READY_TIMEOUT_MS = 1_500;
/** The capture itself must not hold navigation when the browser cannot produce a frame. */
const CAPTURE_TIMEOUT_MS = 500;
const SWITCHING_CLASS = "rk-space-switching";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpaceEpoch(): number {
  return useSyncExternalStore(subscribe, () => epoch);
}

/**
 * Remounts the shell for another space. `commit` selects the space and moves
 * the route; it returns false to abandon the switch, and then nothing remounts.
 * Where the browser supports view transitions, the old screen stays up until
 * the new shell has its bots and conversation, then crossfades to it, so
 * nothing flashes empty. `commit` runs after the old screen is captured, so the
 * old shell keeps talking to its own space until then.
 */
export function remountShellForSpace(commit: () => boolean): void {
  const remount = () => {
    if (!commit()) return false;
    epoch += 1;
    for (const listener of listeners) listener();
    return true;
  };
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (typeof document.startViewTransition !== "function" || document.visibilityState === "hidden" || reducedMotion) {
    remount();
    return;
  }
  const root = document.documentElement;
  activeTransitions += 1;
  root.classList.add(SWITCHING_CLASS);
  let waitingForCapture = true;
  let released = false;
  let transition: ViewTransition | undefined;
  const release = () => {
    if (released) return;
    released = true;
    activeTransitions -= 1;
    if (activeTransitions === 0) root.classList.remove(SWITCHING_CLASS);
  };
  const finishCapture = () => {
    if (!waitingForCapture) return false;
    waitingForCapture = false;
    clearTimeout(captureTimer);
    return true;
  };
  const proceedWithoutMotion = () => {
    if (!finishCapture()) return;
    transition?.skipTransition();
    release();
    remount();
  };
  const captureTimer = window.setTimeout(proceedWithoutMotion, CAPTURE_TIMEOUT_MS);
  try {
    transition = document.startViewTransition(async () => {
      if (!finishCapture()) return;
      let resolveReady = () => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
        window.setTimeout(resolve, READY_TIMEOUT_MS);
      });
      shellReady = resolveReady;
      let remounted = false;
      flushSync(() => {
        remounted = remount();
      });
      if (remounted) await ready;
      if (shellReady === resolveReady) shellReady = null;
    });
  } catch {
    proceedWithoutMotion();
    return;
  }
  const settled = () => {
    proceedWithoutMotion();
    release();
  };
  void transition.finished.then(settled, settled);
}

/** Called by the shell once its bots and conversation are on screen. */
export function markShellReady(): void {
  shellReady?.();
}

/** Async work from a departing shell must not move the next shell's route. */
export function guardShellNavigate(
  getNavigate: () => NavigateFunction,
  isAlive: () => boolean,
): NavigateFunction {
  return (to: To | number, options?: NavigateOptions) => {
    if (!isAlive()) return;
    const navigate = getNavigate();
    return typeof to === "number" ? navigate(to) : navigate(to, options);
  };
}

export function spaceSwitchDecision(
  currentRequest: boolean,
  startedPathname: string,
  pathname: string,
  hasCall: boolean,
): "abandon" | "reload" | "commit" {
  if (!currentRequest || pathname !== startedPathname) return "abandon";
  return hasCall ? "reload" : "commit";
}
