// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DesktopUpdateState } from "@rakazo/contracts";
const fixture = vi.hoisted(() => ({ state: { phase: "ready", currentVersion: "0.3.13", availableVersion: "0.3.15", percent: 100, message: null, checkedAt: null } as DesktopUpdateState }));
const bridge = vi.hoisted(() => ({
  state: vi.fn(async () => ({ ...fixture.state })),
  check: vi.fn(async () => ({ ...fixture.state })),
  install: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: true })),
  forceInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending:true,restartMode:"now" })),
  cancelInstall: vi.fn(async () => (fixture.state = { ...fixture.state, installPending: false })),
  onPrepare: vi.fn(() => () => {}),
}));
vi.mock("../lib/desktop", () => ({ desktopBridge: () => ({ update: bridge }) }));
vi.mock("../lib/desktop-update-work", () => ({ canRestartDesktop: () => true }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (strings: TemplateStringsArray) => strings[0] }), Trans: ({ children }: { children: ReactNode }) => children }));
vi.mock("@rakazo/ui-web", () => ({ Button: (props: ComponentProps<"button">) => <button {...props} />, toast: { custom: vi.fn(), dismiss: vi.fn() } }));
import { DesktopUpdateSection, DesktopUpdatesProvider } from "./DesktopUpdates";
it("shows an automatic safe wait with cancellation rather than asking the user to close the app", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<DesktopUpdatesProvider><DesktopUpdateSection /></DesktopUpdatesProvider>));
    const restart = [...host.querySelectorAll("button")].find(button => button.textContent === "Restart to update")!;
    expect(restart).toBeTruthy();
    await act(async () => restart.click());
    expect(host.textContent).toContain("Waiting for local tasks and unsaved work…");
    expect(restart.disabled).toBe(true);
    const cancel = [...host.querySelectorAll("button")].find(button => button.textContent === "Cancel update")!;
    expect(cancel.disabled).toBe(false);
    await act(async () => cancel.click());
    expect(restart.disabled).toBe(false);
    expect(bridge.install).toHaveBeenCalledTimes(1);
    expect(bridge.cancelInstall).toHaveBeenCalledTimes(1);
    expect(bridge.onPrepare).toHaveBeenCalledWith(expect.any(Function));
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("offers an enabled explicit restart while native tasks keep running", async () => {
  fixture.state={...fixture.state,phase:"ready",installPending:true,supportsForceRestart:true,restartMode:"whenIdle",waitingFor:"local_work"};
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const host=document.createElement("div"),root=createRoot(host);document.body.append(host);
  try {
    await act(async()=>root.render(<DesktopUpdatesProvider><DesktopUpdateSection /></DesktopUpdatesProvider>));
    const button=[...host.querySelectorAll("button")].find(button=>button.textContent==="Restart now")!;
    expect(button).toBeTruthy();expect(button.disabled).toBe(false);
    await act(async()=>button.click());
    expect(bridge.forceInstall).toHaveBeenCalledTimes(1);
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
