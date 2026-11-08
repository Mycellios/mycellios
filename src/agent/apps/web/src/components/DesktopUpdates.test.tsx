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
  forceInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending:true,restartMode:"now" })),
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
import { DesktopUpdatesProvider } from "./DesktopUpdates";
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.safe = true;
  fixture.call = false;
  fixture.state = { phase: "ready", currentVersion: "0.3.23", availableVersion: "0.3.24", percent: 100, message: null, checkedAt: null };
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const render = () => act(async () => root.render(<DesktopUpdatesProvider><main>Chat draft</main></DesktopUpdatesProvider>));
const gate = () => host.querySelector<HTMLDialogElement>("dialog[open]");
const refresh = () => act(async () => { await vi.advanceTimersByTimeAsync(2000); });

it("blocks the window through download and restart without installing before the owner's click", async () => {
  fixture.state = { ...fixture.state, phase: "downloading", percent: 72 };
  await render();
  expect(gate()?.querySelector("progress")?.value).toBe(72);
  expect(gate()?.querySelector("button")).toBeNull();
  expect(gate()?.dispatchEvent(new Event("cancel", { cancelable: true }))).toBe(false);
  fixture.state = { ...fixture.state, phase: "ready" };
  await refresh();
  expect(bridge.install).not.toHaveBeenCalled();
  const restart = gate()!.querySelector("button")!;
  expect(restart.textContent).toBe("Restart to update");
  expect(gate()?.textContent).not.toContain("Later");
  await act(async () => restart.click());
  expect(gate()?.textContent).toContain("Waiting for local tasks and unsaved work…");
  expect(bridge.install).toHaveBeenCalledTimes(1);
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
});

it("waits for unsaved renderer work, then allows a checkpointed restart of native tasks", async () => {
  fixture.safe = false;
  fixture.state = { ...fixture.state, installPending: true, supportsForceRestart: true, restartMode: "whenIdle", waitingFor: "local_work" };
  await render();
  expect(gate()).toBeNull();
  fixture.safe = true;
  await refresh();
  const restart = gate()!.querySelector("button")!;
  expect(restart.textContent).toBe("Restart now");
  await act(async () => restart.click());
  expect(bridge.forceInstall).toHaveBeenCalledTimes(1);
});

it("keeps the gate open on a failed download and provides retry and the official installer", async () => {
  fixture.state = { ...fixture.state, phase: "error", message: "Download failed" };
  await render();
  expect(gate()?.textContent).toContain("Download failed");
  expect(gate()?.querySelector("a")?.href).toBe("https://www.mycellios.com/downloads/desktop");
  await act(async () => gate()!.querySelector("button")!.click());
  expect(bridge.check).toHaveBeenCalledTimes(1);
});

it("lets the user return to their chat when disk space blocks the update", async () => {
  fixture.state.message = "Free at least 6 GB of disk space before restarting to update.";
  await render();
  expect(gate()?.textContent).toContain(fixture.state.message);
  const later = [...gate()!.querySelectorAll("button")].find(button => button.textContent === "Later")!;
  await act(async () => later.click());
  await refresh();
  expect(gate()).toBeNull();
  expect(host.querySelector("main")?.textContent).toBe("Chat draft");
  expect(bridge.install).not.toHaveBeenCalled();
});

it("shows the mandatory update during a call and closes audio before requesting restart", async () => {
  fixture.call = true;
  fixture.state = { ...fixture.state, supportsForceRestart: true };
  await render();
  const restart = gate()!.querySelector("button")!;
  expect(restart.textContent).toBe("End call and restart");
  expect(endCall).not.toHaveBeenCalled();
  await act(async () => restart.click());
  expect(endCall).toHaveBeenCalledBefore(bridge.forceInstall);
});
