import { MICO_AVATAR_SHAPES, withMicoAvatarShape } from "@rakazo/contracts";
import { BotAvatar } from "@rakazo/ui-web";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  type AppearancePreference,
  persistAppearancePreference,
  type ResolvedAppearance,
  resolveAppearance,
  resolveAppearancePreference,
  webTokensForAppearance,
} from "@rakazo/ui-tokens";

export type { AppearancePreference, ResolvedAppearance };

const THEME_COLOR_META = 'meta[name="theme-color"]';
const themeMascot = {
  light: withMicoAvatarShape("", MICO_AVATAR_SHAPES[0].index),
  dark: withMicoAvatarShape("", MICO_AVATAR_SHAPES[4].index),
} satisfies Record<ResolvedAppearance, string>;
let stopAppearanceTransition: (() => void) | undefined;

export function readSystemAppearance(
  media: Pick<MediaQueryList, "matches"> | null = typeof window !== "undefined"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null,
): ResolvedAppearance {
  return media?.matches ? "light" : "dark";
}

export function applyResolvedAppearance(
  appearance: ResolvedAppearance,
  root: HTMLElement | null = typeof document !== "undefined" ? document.documentElement : null,
): void {
  if (!root) return;
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
  if (typeof document === "undefined") return;
  const meta = document.querySelector(THEME_COLOR_META);
  if (meta) {
    meta.setAttribute("content", webTokensForAppearance(appearance).background);
  }
}

export function applyUiAppearance(
  preference: AppearancePreference = resolveAppearancePreference(),
  system: ResolvedAppearance = readSystemAppearance(),
): ResolvedAppearance {
  const resolved = resolveAppearance(preference, system);
  applyResolvedAppearance(resolved);
  return resolved;
}

export function setUiAppearance(preference: AppearancePreference): ResolvedAppearance {
  persistAppearancePreference(preference);
  const appearance = resolveAppearance(preference, readSystemAppearance());
  stopAppearanceTransition?.();
  const root = typeof document === "undefined" ? null : document.documentElement;
  if (
    !root?.dataset.theme ||
    root.dataset.theme === appearance ||
    typeof document.startViewTransition !== "function" ||
    document.visibilityState !== "visible" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    applyResolvedAppearance(appearance, root);
    return appearance;
  }

  const mark = document.createElement("div");
  mark.className = "rk-theme-sweep-mark";
  mark.setAttribute("aria-hidden", "true");
  root.dataset.themeSweep = appearance;
  let cancelled = false;
  let mascotRoot: Root | undefined;
  const cleanup = () => {
    mascotRoot?.unmount();
    mascotRoot = undefined;
    mark.remove();
    if (stopAppearanceTransition === cancel) {
      delete root.dataset.themeSweep;
      stopAppearanceTransition = undefined;
    }
  };
  const transition = document.startViewTransition(() => {
    if (cancelled) return;
    applyResolvedAppearance(appearance, root);
    document.body.append(mark);
    const avatar = createRoot(mark);
    mascotRoot = avatar;
    flushSync(() => avatar.render(createElement(BotAvatar, { color: themeMascot[appearance], size: 60 })));
  });
  function cancel() {
    cancelled = true;
    transition.skipTransition();
    cleanup();
  }
  stopAppearanceTransition = cancel;
  // Skipping an animation can reject ready even though the appearance was applied.
  void transition.ready.catch(() => undefined);
  void transition.finished.then(cleanup, cleanup);
  return appearance;
}

export function getUiAppearancePreference(): AppearancePreference {
  return resolveAppearancePreference();
}

/** Keep `data-theme` in sync when the OS scheme changes and preference is System. */
export function watchSystemAppearance(
  onChange: (system: ResolvedAppearance) => void = () => {
    if (resolveAppearancePreference() === "system") applyUiAppearance("system");
  },
): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia("(prefers-color-scheme: light)");
  const handler = () => onChange(media.matches ? "light" : "dark");
  media.addEventListener("change", handler);
  return () => media.removeEventListener("change", handler);
}
