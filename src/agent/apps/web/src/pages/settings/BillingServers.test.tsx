// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ bridge: undefined as any }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => mock.bridge }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (p: TemplateStringsArray) => p.join("") }), Trans: ({ children }: { children: ReactNode }) => children }));
import { BillingServers } from "./BillingServers";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mock.bridge = undefined; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("shows the current web server without claiming a hosted plan or fake add action", async () => {
  await act(async () => root.render(<BillingServers />));
  expect(host.textContent).toContain("Current server"); expect(host.textContent).toContain("does not purchase a plan");
  expect(host.querySelector('a')?.getAttribute('href')).toBe("https://mycellios.com/downloads/desktop");
  expect([...host.querySelectorAll("button")].some(button => button.textContent?.includes("Add server"))).toBe(false);
});
it("reuses the native directory and guards server switching failures", async () => {
  const list = vi.fn(async () => ({ servers: [{ name: "Work", serverUrl: "https://work.example" }, { name: "Personal", serverUrl: "https://personal.example" }], current: "https://work.example" }));
  const manage = vi.fn(async () => { throw Error("active work"); }); mock.bridge = { servers: { list, manage } };
  await act(async () => root.render(<BillingServers />)); expect(host.textContent).toContain("Current");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Open")!.click());
  expect(manage).toHaveBeenCalledWith("https://personal.example"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Finish active tasks");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Add server"))!.click());
  expect(manage).toHaveBeenLastCalledWith(undefined);
});
it("does not show a false empty state after a directory read fails", async () => {
  mock.bridge = { servers: { list: vi.fn(async () => { throw Error("disk"); }), manage: vi.fn() } };
  await act(async () => root.render(<BillingServers />)); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain("No saved servers yet");
});
