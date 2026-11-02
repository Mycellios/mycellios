// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DesktopDevelopment } from "./DesktopDevelopment";

vi.mock("../lib/rpc", () => ({ rpc: { bots: { setComputer: vi.fn(async () => {}) } } }));

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.rakazoDesktop;
  vi.unstubAllGlobals();
});
it("hides the launcher in browsers, older builds and development itself", async () => {
  await act(async () => root.render(<DesktopDevelopment />));
  expect(host.textContent).toBe("");
  window.rakazoDesktop = { development: { isDevelopment: true } } as any;
  await act(async () => root.render(<DesktopDevelopment />));
  expect(host.textContent).toBe("");
});
it("opens development once, preserving retry after a native failure", async () => {
  let done!: (value: { opened: boolean; error?: string }) => void;
  const open = vi.fn(
    () =>
      new Promise<{ opened: boolean; error?: string }>((resolve) => {
        done = resolve;
      }),
  );
  window.rakazoDesktop = {
    computer: { requestAccess: async () => true },
    development: { open },
  } as any;
  await act(async () => root.render(<DesktopDevelopment />));
  const button = host.querySelector("button")!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(open).toHaveBeenCalledOnce();
  expect(button.disabled).toBe(true);
  await act(async () => done({ opened: false, error: "unavailable" }));
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(button.disabled).toBe(false);
});
