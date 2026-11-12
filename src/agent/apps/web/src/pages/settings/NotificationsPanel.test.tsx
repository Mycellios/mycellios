// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationsPanel } from "./NotificationsPanel";
import { notificationPreferences } from "../../lib/notification-preferences";
const api = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn(), show: vi.fn(), android: false, androidRequest: vi.fn(), androidStatus: vi.fn(), native: null as any }));
vi.mock("../../lib/rpc", () => ({ rpc: { notifications: { webStatus: api.status, saveSettings: api.save, androidStatus: api.androidStatus } } }));
vi.mock("../../lib/web-push", () => ({ enableWebPush: vi.fn(), isInstalledWebApp: () => false, notificationClientId: () => "client", pushSupported: () => false }));
vi.mock("../../lib/android-host", () => ({ isAndroidHost: () => api.android, androidNotificationRequest: api.androidRequest }));
vi.mock("../../lib/desktop", () => ({ desktopBridge: () => api.native }));
vi.mock("../../lib/browser-notifications", () => ({ requestBrowserNotificationPermission: vi.fn(async () => "granted"), showSystemNotification: api.show }));
vi.mock("./SoundSettings", () => ({ SoundSettings: () => <div>Sound controls</div> }));
vi.mock("@lingui/react/macro", () => ({ Trans: ({ children }: { children: ReactNode }) => children,
  useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), "") }) }));
vi.mock("@rakazo/ui-web", async importOriginal => ({ ...(await importOriginal<typeof import("@rakazo/ui-web")>()),
  OptionSelect: ({ value, options, onValueChange, disabled, "aria-label": label }: { value: string; options: { value: string; label: string }[]; onValueChange: (value: string) => void; disabled?: boolean; "aria-label"?: string }) =>
    <select aria-label={label} disabled={disabled} value={value} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
}));
const state = () => ({ configured: false, publicKey: null, registered: false,
  settings: { level: "all", previews: false, mutedUntil: null, bots: {} }, bots: [{ id: "mico", name: "Research", notifyOnFinish: true }] });
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); vi.clearAllMocks(); api.native = null; api.android = false; api.androidStatus.mockResolvedValue({ configured: true });
  api.androidRequest.mockResolvedValue({ supported: true, configured: true, registered: true, permission: "granted" });
  vi.stubGlobal("Notification", { permission: "granted" });
  api.status.mockResolvedValue(state()); api.save.mockImplementation(async value => value); api.show.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = async (scope = "owner") => { await act(async () => root.render(<NotificationsPanel scope={scope} />)); };
const button = (label: string, within: ParentNode = host) => [...within.querySelectorAll("button")].find(b => b.textContent === label)!;
it("saves a global filter with no optimistic success and preserves it on failure", async () => {
  await render(); const group = host.querySelector('[role="group"][aria-label="Account notifications"]')!;
  api.save.mockRejectedValueOnce(Error("offline"));
  await act(async () => button("If I’m needed", group).click());
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ level: "needs_me", previews: false }));
  expect(button("All", group).getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Try again");
  await act(async () => button("No alerts", group).click());
  expect(button("No alerts", group).getAttribute("aria-pressed")).toBe("true");
});
it("keeps local switches separate from account filters and reports requested rather than delivered tests", async () => {
  await render(); const control = host.querySelector<HTMLButtonElement>('[data-testid="notification-preview"]')!;
  await act(async () => control.click()); expect(notificationPreferences("owner").preview).toBe(false); expect(api.save).not.toHaveBeenCalled();
  await act(async () => button("Send test").click()); expect(api.show).toHaveBeenCalledOnce();
  expect(host.textContent).toContain("Test requested"); expect(host.textContent).not.toContain("Test delivered");
  expect(host.querySelectorAll('[data-slot="collapsible-trigger"],details')).toHaveLength(0);
});
it("shows a load failure and retries without fabricating account defaults", async () => {
  api.status.mockRejectedValueOnce(Error("offline")); await render();
  expect(host.querySelector('[aria-label="Account notifications"]')).toBeNull();
  await act(async () => button("Retry").click()); expect(host.querySelector('[aria-label="Account notifications"]')).not.toBeNull();
});
it("does not show another account's late settings after switching scope", async () => {
  let finish!: (value: ReturnType<typeof state>) => void;
  api.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render("old");
  api.status.mockResolvedValueOnce({ ...state(), settings: { ...state().settings, level: "off" } }); await render("new");
  await act(async () => finish(state()));
  const group = host.querySelector('[aria-label="Account notifications"]')!;
  expect(button("No alerts", group).getAttribute("aria-pressed")).toBe("true");
});
it("reports a native settings failure instead of silently accepting a false result", async () => {
  api.native = { notifications: { status: async () => ({ supported: true, settingsAvailable: true }), openSettings: vi.fn(async () => false) } };
  await render(); await act(async () => button("Open system notification settings").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Try again");
});

it("saves a Mico exception, changes its filter and restores account inheritance", async () => {
  await render(); const chooser = host.querySelector<HTMLSelectElement>('select[aria-label="Choose for a Mico"]')!;
  await act(async () => { chooser.value = "mico"; chooser.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ bots: { mico: "all" } }));
  const group = host.querySelector('[role="group"][aria-label="Notifications: Research"]')!;
  await act(async () => button("No alerts", group).click());
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ bots: { mico: "off" } }));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Use account setting: Research"]')!.click());
  expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ bots: {} }));
  expect(host.querySelector('[aria-label="Notifications: Research"]')).toBeNull();
});
it("serializes saves and disables conflicting controls until the server confirms", async () => {
  await render(); let finish!: (value: object) => void;
  api.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const group = host.querySelector('[aria-label="Account notifications"]')!;
  await act(async () => button("If I’m needed", group).click());
  expect(button("All", group).disabled).toBe(true);
  await act(async () => button("No alerts", group).click()); expect(api.save).toHaveBeenCalledOnce();
  await act(async () => finish({ ...state().settings, level: "needs_me" }));
  expect(button("If I’m needed", group).getAttribute("aria-pressed")).toBe("true");
  expect(button("All", group).disabled).toBe(false);
});

it("keeps native Android tests on the Firebase bridge instead of browser notifications", async () => {
  api.android = true; await render();
  await act(async () => button("Send test").click());
  expect(api.androidRequest).toHaveBeenCalledWith("test", { accountId: "owner" });
  expect(api.show).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Native Android alerts use Firebase");
});
it("requires native registration even when Android system permission is already granted", async () => {
  api.android = true;
  api.androidRequest.mockImplementation(async (type: string) => ({ supported: true, configured: true, registered: type === "enable", permission: "granted" }));
  await render();
  expect(button("Send test").disabled).toBe(true);
  await act(async () => button("Enable notifications").click());
  expect(api.androidRequest).toHaveBeenCalledWith("enable", { accountId: "owner" });
});
