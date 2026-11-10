// @vitest-environment jsdom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopUpdateState, DesktopUpdatePreferences } from "@rakazo/contracts";
const mock = vi.hoisted(() => ({ desktop: false, modern: false,
  native: { state: null as DesktopUpdateState | null, busy: false, message: null as string | null, confirmedCheck: null as string | null, act: vi.fn() },
  preferences: { channel: "stable", supported: true, autoDownload: true, autoInstall: false } as DesktopUpdatePreferences,
  save: vi.fn(), check: vi.fn(async () => "20261029170000"),
}));
const bridge = { preferences: async () => mock.preferences, savePreferences: mock.save, restartWhenIdle: vi.fn() };
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => mock.desktop ? { update: mock.modern ? bridge : {} } : null }));
vi.mock("../../lib/client-build", () => ({ CLIENT_BUILD: "20261029170000" }));
const webUpdates = { getSnapshot: () => null, subscribe: () => () => {}, checkForUpdates: mock.check };
vi.mock("../../lib/client-update", () => ({ clientUpdates: () => webUpdates }));
vi.mock("../../components/DesktopUpdates", () => ({
  DesktopUpdateSection: () => <section>Legacy Desktop app</section>,
  useDesktopUpdateSettings: () => mock.modern ? mock.native : null,
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({ variant: _v, size: _s, ...props }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
  Label: (props: ComponentProps<"label">) => <label {...props} />,
  Switch: ({ checked, onCheckedChange, ...props }: ComponentProps<"button"> & { checked: boolean; onCheckedChange: (v: boolean) => void }) =>
    <button {...props} role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} />,
}));
vi.mock("../../components/SettingsRows", () => ({
  SettingsGroup: ({ title, children }: { title?: ReactNode; children: ReactNode }) => <section>{title && <h2>{title}</h2>}{children}</section>,
  SettingsRow: ({ label, description, control }: { label: ReactNode; description?: ReactNode; control?: ReactNode }) => <div>{label}{description}{control}</div>,
}));
import { UpdatesPanel } from "./UpdatesPanel";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  mock.desktop = false; mock.modern = false;
  mock.native.state = { phase: "idle", currentVersion: "0.3.27", availableVersion: null, message: null, checkedAt: null, percent: null };
  mock.preferences = { channel: "stable", supported: true, autoDownload: true, autoInstall: false };
  mock.save.mockImplementation(async patch => ({ ...mock.preferences, ...patch }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(props: Partial<ComponentProps<typeof UpdatesPanel>> = {}) { await act(async () => root.render(<UpdatesPanel onClose={() => {}} {...props} />)); }
function button(text: string) { return [...host.querySelectorAll("button")].find(b => b.textContent === text)!; }
function toggle(text: string) { const label = [...host.querySelectorAll("label")].find(l => l.textContent === text)!; return host.querySelector<HTMLButtonElement>(`[id="${label.htmlFor}"]`)!; }
it("supports older Desktop bridges without showing a second update workflow", async () => {
  mock.desktop = true; await render();
  expect(host.textContent).toContain("Legacy Desktop app"); expect(host.textContent).not.toContain("Check for updates");
  expect(host.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded")).toBe("false");
});
it("checks the web build without showing unsupported native switches", async () => {
  await render(); await act(async () => button("Check for updates").click());
  expect(mock.check).toHaveBeenCalledOnce(); expect(host.textContent).toContain("Up to date");
  expect(host.querySelector('[role="switch"]')).toBeNull(); expect(button("Restart when idle")).toBeUndefined();
});
it("downloads a metadata-only available release rather than claiming it is already downloading", async () => {
  mock.desktop = mock.modern = true; mock.native.state!.phase = "available"; await render();
  await act(async () => button("Download update").click()); expect(mock.native.act).toHaveBeenCalledWith("download");
  expect(host.textContent).not.toContain("server members");
});
it("keeps the saved preference on disk errors and releases the navigation guard", async () => {
  mock.desktop = mock.modern = true; mock.save.mockRejectedValue(Error("disk")); const busy = vi.fn(); await render({ onBusyChange: busy });
  await act(async () => toggle("Download updates automatically").click());
  expect(mock.save).toHaveBeenCalledWith({ autoDownload: false }); expect(toggle("Download updates automatically").getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not save"); expect(busy).toHaveBeenLastCalledWith(false);
});
it("shows development capabilities accurately and disables managed switches", async () => {
  mock.desktop = mock.modern = true; mock.preferences = { ...mock.preferences, channel: "development", supported: false };
  mock.native.state!.phase = "unsupported"; await render();
  expect(host.textContent).toContain("local development"); expect(button("Check for updates").disabled).toBe(true);
  expect(toggle("Install updates automatically").disabled).toBe(true);
});
it("allows cancelling a pending restart while keeping other update actions disabled", async () => {
  mock.desktop = mock.modern = true; mock.native.state!.relaunchPending = true; await render();
  expect(button("Check for updates").disabled).toBe(true);
  await act(async () => button("Cancel restart").click()); expect(mock.native.act).toHaveBeenCalledWith("cancelRestart");
});
