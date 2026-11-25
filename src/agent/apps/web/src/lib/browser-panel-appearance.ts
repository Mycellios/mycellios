import { BROWSER_EXTENSION_ORIGINS } from "@mycellios/contracts/content-security-policy";
import { applyUiAppearance } from "./ui-appearance";

function receiveBrowserPanelAppearance(event: MessageEvent<unknown>): void {
  if (
    event.source !== window.parent ||
    !BROWSER_EXTENSION_ORIGINS.some(origin => origin === event.origin)
  ) return;

  const data = event.data;
  if (typeof data !== "object" || data === null || !("type" in data) ||
      data.type !== "mycellios:browser-panel-appearance" ||
      !("theme" in data) || !("discreet" in data) || typeof data.discreet !== "boolean") return;
  if (data.theme !== "original" && data.theme !== "light" && data.theme !== "dark") return;

  const root = document.documentElement;
  if (data.theme === "original") delete root.dataset.browserPanelTheme;
  else root.dataset.browserPanelTheme = data.theme;
  root.toggleAttribute("data-browser-panel-discreet", data.discreet);
  applyUiAppearance();
}

export function installBrowserPanelAppearance(): () => void {
  if (window.parent === window) return () => undefined;
  window.addEventListener("message", receiveBrowserPanelAppearance);
  return () => window.removeEventListener("message", receiveBrowserPanelAppearance);
}
