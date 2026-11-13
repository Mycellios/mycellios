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
  install: vi.fn(async (): Promise<DesktopUpdateState> => (fixture.state = { ...fixture.state, installPending: true })),
  forceInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: true, restartMode: "now" })),
  cancelInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: false })),
  cancelRestart: vi.fn(async () => (fixture.state = { ...fixture.state, relaunchPending: false, relaunchWaitingFor: undefined, automaticRestartAt: undefined })),
  download: vi.fn(async () => (fixture.state = { ...fixture.state, phase: "downloading" as const, percent: null })),
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
import { DesktopSidebarUpdate, DesktopUpdateSection, DesktopUpdatesProvider } from "./DesktopUpdates";
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
it("shows one compact notice with real download progress and no blocking dialog", async () => {
  fixture.state = { ...fixture.state, phase: "available", percent: null };
  await render();
  expect(host.querySelectorAll("aside.myc-update-notice")).toHaveLength(1);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Download update"]')!.click());
  expect(bridge.download).toHaveBeenCalledOnce(); expect(gate()).toBeNull();
  expect(host.querySelector("progress")?.hasAttribute("value")).toBe(false);
  fixture.state = { ...fixture.state, percent: 61.4 }; await refresh();
  expect(host.querySelector("progress")?.value).toBe(61);
  expect(host.querySelector("button")?.textContent).toBe("61%");
  expect(host.querySelector("button")?.disabled).toBe(true);
  fixture.state = { ...fixture.state, phase: "idle", availableVersion: null }; await refresh();
  expect(host.querySelector(".myc-update-notice")).toBeNull();
});
it("keeps automatic restarts cancellable in the sidebar without covering the chat", async () => {
  fixture.state = { ...fixture.state, autoInstallEnabled: true, relaunchPending: true,
    automaticRestartAt: Date.now() + 15_000 };
  await render(); expect(gate()).toBeNull();
  expect(host.textContent).toContain("Updating shortly");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Later")!.click());
  expect(bridge.cancelRestart).toHaveBeenCalledOnce(); expect(bridge.install).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Updating shortly");
  expect(gate()).toBeNull();
});
it("keeps downloads and staged updates in the sidebar until the owner's explicit restart", async () => {
  fixture.state.phase = "downloading"; fixture.state.percent = 72;
  await render(); expect(gate()).toBeNull();
  expect(host.querySelector("progress")?.value).toBe(72);
  fixture.state.phase = "ready"; await refresh();
  expect(gate()).toBeNull(); expect(bridge.install).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!.click());
  expect(bridge.install).toHaveBeenCalledExactlyOnceWith(); expect(gate()).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Later")!.click());
  expect(bridge.cancelInstall).toHaveBeenCalledOnce(); expect(gate()).toBeNull();
});
it("leaves failures actionable without trapping the user on reopening", async () => {
  fixture.state.phase = "error"; fixture.state.message = "Download failed";
  await render(); expect(gate()).toBeNull();
  expect(host.textContent).toContain("Download failed");
  expect(host.querySelector("a")).toBeNull();
  expect(host.querySelectorAll("aside.myc-update-notice button")).toHaveLength(1);
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
it("retries a staged installer after a handoff failure instead of only checking its unchanged feed", async () => {
  fixture.state = { ...fixture.state, message: "Could not complete the update. Try again.", relaunchError: true };
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Try again"]')!.click());
  expect(bridge.install).toHaveBeenCalledOnce();
  expect(bridge.check).not.toHaveBeenCalled();
  expect(gate()).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
});
it("waits for unsaved work and preserves explicit checkpointed restart of native tasks", async () => {
  fixture.safe = false;
  fixture.state = { ...fixture.state, installPending: true, supportsForceRestart: true, restartMode: "whenIdle", waitingFor: "local_work" };
  await render(); expect(gate()).toBeNull();
  expect([...host.querySelectorAll("button")].find(b => b.textContent === "Later")?.disabled).toBe(false);
  fixture.safe = true; await refresh();
  await act(async () => root.render(<DesktopUpdatesProvider><DesktopUpdateSection /></DesktopUpdatesProvider>));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Restart now")!.click());
  expect(bridge.forceInstall).toHaveBeenCalledOnce();
});
it("keeps audio running until the user requests restart and ends it before handoff", async () => {
  fixture.call = true; await render(); expect(gate()).toBeNull(); expect(endCall).not.toHaveBeenCalled();
  const restart = host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!;
  expect(restart.textContent).toBe("End call and restart");
  await act(async () => restart.click()); expect(endCall).toHaveBeenCalledBefore(bridge.install);
});
it("hands a package-manager update to the system installer instead of announcing a restart", async () => {
  fixture.state.installAction = "system-installer"; fixture.state.supportsForceRestart = false;
  await render();
  expect(host.textContent).toContain("Update ready to install");
  const action = host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!;
  expect(action.textContent).toBe("Open installer");
  await act(async () => action.click());
  expect(bridge.install).toHaveBeenCalledOnce();
});

it("shows an accepted idle restart and cancels its native controller", async () => {
  bridge.install.mockImplementationOnce(async () => (fixture.state = { ...fixture.state,
    relaunchPending: true, relaunchWaitingFor: "local_work", supportsForceRestart: true }));
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Install update"]')!.click());
  expect(host.textContent).toContain("Update waiting");
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Later"]')!.textContent).toBe("Later");
  expect(bridge.forceInstall).not.toHaveBeenCalled();
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Later")!.click());
  expect(bridge.cancelRestart).toHaveBeenCalledOnce();
  expect(bridge.cancelInstall).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Update waiting");
});

it("explains a renderer refusal and a failed native restart instead of staying silently ready", async () => {
  fixture.state = { ...fixture.state, relaunchPending: true, relaunchWaitingFor: "unsaved_work" };
  await render();
  expect(host.textContent).toContain("Save changes or finish the call to restart.");
  fixture.state = { ...fixture.state, relaunchPending: false, relaunchError: true };
  await refresh();
  expect(host.textContent).toContain("Could not complete the update. Try again.");
  expect(host.querySelector('button[aria-label="Try again"]')?.hasAttribute("disabled")).toBe(false);
});


it("uses a single postpone action for unsaved work without forcing a restart", async () => {
  fixture.safe = false;
  fixture.state = { ...fixture.state, installPending: true, waitingFor: "unsaved_work", supportsForceRestart: true };
  await render();
  const notice = host.querySelector("aside.myc-update-notice")!;
  expect(notice.querySelectorAll("button")).toHaveLength(1);
  expect(notice.querySelector("a")).toBeNull();
  expect(notice.textContent).toContain("Save changes or finish the call to restart.");
  await act(async () => notice.querySelector<HTMLButtonElement>("button")!.click());
  expect(bridge.cancelInstall).toHaveBeenCalledOnce();
  expect(bridge.install).not.toHaveBeenCalled();
  expect(bridge.forceInstall).not.toHaveBeenCalled();
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
});

it("does not treat a successful system-installer handoff as an error or offer it twice", async () => {
  fixture.state = { ...fixture.state, handoffComplete: true, installAction: "system-installer" };
  await render();
  const notice = host.querySelector("aside.myc-update-notice")!;
  expect(notice.hasAttribute("data-failed")).toBe(false);
  expect(notice.textContent).toContain("Opened the system installer");
  expect(notice.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  expect(notice.querySelectorAll("button")).toHaveLength(1);
  expect(notice.querySelector("a")).toBeNull();
});

it("keeps manual download recovery in update settings instead of competing sidebar actions", async () => {
  fixture.state = { ...fixture.state, phase: "error", message: "Download failed" };
  await act(async () => root.render(<DesktopUpdatesProvider><DesktopSidebarUpdate /><DesktopUpdateSection /></DesktopUpdatesProvider>));
  expect(host.querySelector("aside.myc-update-notice a")).toBeNull();
  expect(host.querySelectorAll("aside.myc-update-notice button")).toHaveLength(1);
  const settings = host.querySelector('[data-testid="desktop-update-settings"]')!;
  expect(settings.textContent).toContain("Download failed");
  expect(settings.querySelector("a")?.href).toBe("https://www.mycellios.com/downloads/desktop");
});
