// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: String.raw }) }));
vi.mock("@mycellios/ui-web", () => ({ BotAvatar: () => <span data-testid="mico" /> }));
vi.mock("@mycellios/ui-web/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({}) }));
import { CHROME_EXTENSION_URL, ChromeExtensionCard } from "./ChromeExtensionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
beforeEach(() => { window.localStorage.clear(); host = document.createElement("div"); document.body.append(host); });
afterEach(() => { host.remove(); });

function mount() {
  const root = createRoot(host);
  act(() => root.render(<ChromeExtensionCard mico={{ id: "bot-1", color: "purple" }} />));
  return root;
}

it("links to the store listing and stays closed once dismissed", () => {
  const root = mount();
  expect(host.querySelector("a")?.getAttribute("href")).toBe(CHROME_EXTENSION_URL);
  expect(host.textContent).toContain("Your Micos, in Chrome");
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toBe("");
  act(() => root.unmount());
  mount();
  expect(host.textContent).toBe("");
});

it("is not offered inside a frame, where the extension's panel shows the app", () => {
  const top = vi.spyOn(window, "top", "get").mockReturnValue({} as Window);
  mount();
  expect(host.textContent).toBe("");
  top.mockRestore();
});
