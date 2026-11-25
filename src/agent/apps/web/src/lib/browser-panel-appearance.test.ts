// @vitest-environment jsdom
import { BROWSER_EXTENSION_ORIGINS } from "@mycellios/contracts/content-security-policy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserPanelAppearance } from "./browser-panel-appearance";
import { applyUiAppearance, setUiAppearance } from "./ui-appearance";

const type = "mycellios:browser-panel-appearance";
const root = document.documentElement;
let parent: Window;
let stop: () => void;

function message(origin: string, source: MessageEventSource, data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { origin, source, data }));
}

beforeEach(() => {
  parent = document.createElement("iframe").contentWindow ?? Object.create(window);
  vi.spyOn(window, "parent", "get").mockReturnValue(parent);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  applyUiAppearance("light");
  stop = installBrowserPanelAppearance();
});

afterEach(() => {
  stop();
  delete root.dataset.browserPanelTheme;
  root.removeAttribute("data-browser-panel-discreet");
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("browser panel appearance", () => {
  it.each(BROWSER_EXTENSION_ORIGINS)("accepts preferences from the parent %s", origin => {
    message(origin, parent, { type, theme: "dark", discreet: true });
    expect(root.dataset.browserPanelTheme).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.hasAttribute("data-browser-panel-discreet")).toBe(true);

    setUiAppearance("light");
    expect(root.dataset.theme).toBe("dark");

    message(origin, parent, { type, theme: "original", discreet: false });
    expect(root.dataset.browserPanelTheme).toBeUndefined();
    expect(root.dataset.theme).toBe("light");
    expect(root.hasAttribute("data-browser-panel-discreet")).toBe(false);
  });

  it("ignores unrelated origins, windows and malformed settings", () => {
    const origin = BROWSER_EXTENSION_ORIGINS[0];
    message("https://example.com", parent, { type, theme: "dark", discreet: true });
    message(origin, window, { type, theme: "dark", discreet: true });
    message(origin, parent, { type, theme: "blue", discreet: true });
    message(origin, parent, { type, theme: "dark", discreet: "true" });
    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.browserPanelTheme).toBeUndefined();
    expect(root.hasAttribute("data-browser-panel-discreet")).toBe(false);
  });
});
