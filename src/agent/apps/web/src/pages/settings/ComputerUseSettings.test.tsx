// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), bridge: undefined as any }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }), Trans: ({children}: {children: ReactNode}) => children }));
vi.mock("../../lib/computer-sandbox", () => ({ refreshSandboxFromServer: mocks.refresh, sandboxProviderLabel: (p: string) => p }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => mocks.bridge }));
vi.mock("../../components/ComputersUnavailableHint", () => ({ ComputersUnavailableHint: () => <p data-testid="setup-guidance">Setup guidance</p> }));
import { ComputerSettingsPanel, computerSetupPhase } from "./ComputerUseSettings";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); mocks.bridge = undefined;
  mocks.refresh.mockResolvedValue({ sandboxProvider: "docker" }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(provider = "docker", change = vi.fn(), technical = false) { await act(async () => root.render(<ComputerSettingsPanel sandboxProvider={provider} onSandboxProviderChange={change} showTechnicalDetails={technical} />)); }
it("never promotes missing, test or unknown providers to configured", () => {
  for (const value of [null, undefined, "fake", "future-provider"]) expect(computerSetupPhase(value)).toBe("unknown");
  expect(computerSetupPhase("none")).toBe("unavailable"); expect(computerSetupPhase("desktop")).toBe("configured");
});
it("checks fresh server status and separates web-device access from the work environment", async () => {
  await render(); expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-phase="configured"]')).not.toBeNull();
  expect(host.textContent).toContain("This page does not grant access");
  expect(host.textContent).toContain("Screen access and each Mico’s connection are checked separately");
  expect(host.querySelector('[data-testid="setup-guidance"]')).toBeNull();
});
it("clears a cached configured status on failure and retries through the real check", async () => {
  mocks.refresh.mockRejectedValueOnce(Error("private server detail")); await render();
  expect(host.querySelector('[data-phase="error"]')).not.toBeNull(); expect(host.textContent).not.toContain("private server detail");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Check again")!.click());
  expect(mocks.refresh).toHaveBeenCalledTimes(2); expect(host.querySelector('[data-phase="configured"]')).not.toBeNull();
});
it("does not request native access while reading settings", async () => {
  const requestAccess = vi.fn(); mocks.bridge = { computer: { requestAccess } }; await render();
  expect(requestAccess).not.toHaveBeenCalled(); expect(host.textContent).toContain("Mycellios Desktop");
});
it("shows setup guidance only when the fresh provider is unavailable and notifies recovery", async () => {
  const change = vi.fn(); mocks.refresh.mockResolvedValueOnce({ sandboxProvider: "none" }); await render("none", change, true);
  expect(host.querySelector('[data-testid="setup-guidance"]')).not.toBeNull();
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Check again")!.click());
  expect(change).toHaveBeenCalledWith("docker"); expect(host.querySelector('[data-testid="setup-guidance"]')).toBeNull();
});
it("does not allow repeated checks or accept a late result after the environment changes", async () => {
  let finish!: (value: any) => void; mocks.refresh.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render(); expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  await render("none"); expect(host.querySelector('[data-phase="configured"]')).not.toBeNull();
  await act(async () => finish({ sandboxProvider: "none" })); expect(host.querySelector('[data-phase="configured"]')).not.toBeNull();
});

it("keeps server setup instructions out of ordinary settings", async () => {
  mocks.refresh.mockResolvedValueOnce({ sandboxProvider: "none" }); await render("none");
  expect(host.querySelector('[data-testid="setup-guidance"]')).toBeNull();
  expect(host.textContent).toContain("Computer tools need setup");
});
