import "./agent-style.css";
import "./agent-components.css";

export type DesignProfile = "agent" | "classic";
const storageKey = "mycellios.design-profile";

export function applyDesignProfile(profile: DesignProfile): void {
  document.documentElement.dataset.mycelliosDesign = profile;
}

// An explicit URL also saves the choice so it survives navigation between pages.
export function initializeDesignProfile(): void {
  const requested = new URLSearchParams(window.location.search).get("design");
  let profile: DesignProfile = "agent";
  try {
    if (localStorage.getItem(storageKey) === "classic") profile = "classic";
    if (requested === "agent" || requested === "classic") localStorage.setItem(storageKey, requested);
  } catch { /* The URL and default still work when storage is unavailable. */ }
  if (requested === "agent" || requested === "classic") profile = requested;
  applyDesignProfile(profile);
}
