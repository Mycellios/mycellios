// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@rakazo/ui-web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MOBILE_INSTALL_URL, MobileInstallOffer, mobileInstallUrl } from "./MobileInstallOffer";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Fixture({ mini = false }: { mini?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <TooltipProvider>
      <MobileInstallOffer mini={mini} open={open} onOpenChange={setOpen} />
      <button onClick={() => setOpen(true)}>Open mobile help again</button>
    </TooltipProvider>
  );
}
async function render(mini = false) {
  await act(async () => root.render(<Fixture mini={mini} />));
}
function button(name: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") || b.textContent) === name,
  )!;
}

it("shares the correct server namespace without private chat paths or queries", () => {
  expect(mobileInstallUrl("https://www.mycellios.com", "/agent/")).toBe(MOBILE_INSTALL_URL);
  expect(mobileInstallUrl("https://private.example.test", "/")).toBe(
    "https://private.example.test/",
  );
  expect(mobileInstallUrl("http://localhost:5191", "/")).toBe(MOBILE_INSTALL_URL);
  expect(mobileInstallUrl("http://[::1]:5191", "/")).toBe(MOBILE_INSTALL_URL);
});

it("keeps dismissal across mounts and still permits reopening the guide", async () => {
  await render();
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).not.toBeNull();
  await act(async () => button("Dismiss mobile invitation").click());
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).toBeNull();
  await act(async () => root.render(<div />));
  await render();
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).toBeNull();
  await act(async () => button("Open mobile help again").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Mycellios on your phone",
  );
});

it("hides the invitation in an installed Android PWA", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android Chrome");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  await render();
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).toBeNull();
});

it("does not hide the phone invitation in an installed desktop PWA", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows Chrome");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  await render();
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).not.toBeNull();
});

it("hides the invitation after Android confirms installation in this visit", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Android Chrome");
  await render();
  await act(async () => { window.dispatchEvent(new Event("appinstalled")); });
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).toBeNull();
});

it("starts with iPhone instructions on iOS and preserves the current page", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone Safari");
  const before = location.href;
  await render();
  await act(async () => button("How to install").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Open the link in Safari",
  );
  expect(
    document.querySelector('a[href="' + MOBILE_INSTALL_URL + '"]')?.getAttribute("target"),
  ).toBe("_blank");
  expect(location.href).toBe(before);
});

it("reports clipboard rejection without closing instructions or navigating", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  await render();
  await act(async () => button("How to install").click());
  await act(async () => button("Copy mobile link").click());
  expect(document.querySelector('[role="status"]')?.textContent).toContain("Could not copy");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("keeps a compact accessible action when the sidebar is minimized", async () => {
  await render(true);
  expect(button("Mycellios on your phone")).toBeDefined();
  expect(host.querySelector('[data-testid="mobile-install-offer"]')).toBeNull();
});
