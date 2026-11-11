// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "@rakazo/contracts";
const fixture = vi.hoisted(() => ({ state: {} as DesktopUpdateState, safe: true, call: false }));
const bridge = vi.hoisted(() => ({
  state: vi.fn(async () => ({ ...fixture.state })),
  check: vi.fn(async () => ({ ...fixture.state })),
  install: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: true })),
  forceInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: true, restartMode: "now" })),
  cancelInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: false })),
  onPrepare: vi.fn(() => () => {}),
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({ update: bridge }) }));
const endCall = vi.hoisted(() => vi.fn(() => { fixture.call = false; }));
vi.mock("../lib/desktop-update-work", () => ({
  canRestartDesktop: () => fixture.safe && !fixture.call,
  canShowDesktopUpdate: () => fixture.safe,
  desktopUpdateHasCall: () => fixture.call,
  endDesktopUpdateCall: endCall,
}));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (strings: TemplateStringsArray) => strings[0] }), Trans: ({ children }: { children: ReactNode }) => children }));
vi.mock("@rakazo/ui-web", () => ({ Button: (props: ComponentProps<"button">) => <button {...props} /> }));
import { DesktopSidebarUpdate, DesktopUpdatesProvider } from "./DesktopUpdates";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.safe = true; fixture.call = false;
  fixture.state = { phase: "ready", currentVersion: "0.3.33", availableVersion: "0.3.35", percent: 100, message: null, checkedAt: null };
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const render = () => act(async () => root.render(<DesktopUpdatesProvider><main>Chat draft</main><DesktopSidebarUpdate /></DesktopUpdatesProvider>));
const gate = () => host.querySelector<HTMLDialogElement>("dialog[open]");
const refresh = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });
it("keeps downloads and staged updates in the sidebar until the owner's explicit restart", async () => {
  fixture.state.phase = "downloading"; fixture.state.percent = 72;
  await render(); expect(gate()).toBeNull();
  expect(host.querySelector("progress")?.value).toBe(72);
  fixture.state.phase = "ready"; await refresh();
  expect(gate()).toBeNull(); expect(bridge.install).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!.click());
  expect(bridge.install).toHaveBeenCalledExactlyOnceWith(); expect(gate()).not.toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
  await act(async () => [...gate()!.querySelectorAll("button")].find(b => b.textContent === "Cancel update")!.click());
  expect(bridge.cancelInstall).toHaveBeenCalledOnce(); expect(gate()).toBeNull();
});
it("leaves failures actionable without trapping the user on reopening", async () => {
  fixture.state.phase = "error"; fixture.state.message = "Download failed";
  await render(); expect(gate()).toBeNull();
  expect(host.textContent).toContain("Download failed");
  expect(host.querySelector("a")?.href).toBe("https://www.mycellios.com/downloads/desktop");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Try again")!.click());
  expect(bridge.check).toHaveBeenCalledOnce();
});
it("keeps the chat accessible if another helper or disk capacity blocks installation", async () => {
  fixture.state.message = "Another update is still running. Keep using Mycellios and finish that installation before retrying.";
  await render(); expect(gate()).toBeNull(); expect(host.textContent).toContain("Another update is still running");
  fixture.state.message = "Free at least 6 GB of disk space before restarting to update.";
  await refresh(); expect(gate()).toBeNull(); expect(host.textContent).toContain("6 GB");
  expect(bridge.install).not.toHaveBeenCalled();
});
it("waits for unsaved work and preserves explicit checkpointed restart of native tasks", async () => {
  fixture.safe = false;
  fixture.state = { ...fixture.state, installPending: true, supportsForceRestart: true, restartMode: "whenIdle", waitingFor: "local_work" };
  await render(); expect(gate()).toBeNull();
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "Cancel update")?.disabled).toBe(false);
  fixture.safe = true; await refresh();
  await act(async () => [...gate()!.querySelectorAll("button")].find(b => b.textContent === "Restart now")!.click());
  expect(bridge.forceInstall).toHaveBeenCalledOnce();
});
it("keeps audio running until the user requests restart and ends it before handoff", async () => {
  fixture.call = true; await render(); expect(gate()).toBeNull(); expect(endCall).not.toHaveBeenCalled();
  const restart = host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!;
  expect(restart.textContent).toBe("End call and restart");
  await act(async () => restart.click()); expect(endCall).toHaveBeenCalledBefore(bridge.install);
});
