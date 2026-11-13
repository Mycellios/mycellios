// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ network: vi.fn() }));
vi.mock("../../lib/event-demo", () => ({ demoApi: () => ({ network: f.network }) }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray) => s.join("") }) }));
vi.mock("@rakazo/ui-web", () => ({ BotAvatar: () => <span />, Button: (props: any) => <button {...props} /> }));
vi.mock("../../components/ServerLinkCode", () => ({ ServerLinkCode: () => <span>QR</span> }));
import { DemoPresenter } from "./Presenter";
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
const device = (number: number, present = true, connected = false, working = false) => ({ number, present, connected, working, kind: "mobile", earnedMicrounits: 0, inferences: 0 });
const snapshot = (devices: ReturnType<typeof device>[], open = true) => ({ open, devices, joined: 50, maxGuests: 50, connected: devices.filter(d => d.connected).length, inferences: 7, earnedMicrounits: 0, at: Date.now(), inviteUrl: "https://example.invalid/demo" });
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.location.hash = "view=test-only-presenter";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const mount = async () => { await act(async () => root.render(<DemoPresenter id="test-only-event" />)); };
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(2000); }); };
const count = () => host.querySelector('[data-testid="demo-present-count"]')?.textContent;
const compute = () => host.querySelector('[data-testid="demo-compute-count"]')?.textContent;
it("shows current app presence separately from contributing browsers, not cumulative admissions", async () => {
  f.network.mockResolvedValue(snapshot([device(1), device(2, false), device(3, false, true)]));
  await mount(); expect(count()).toBe("2"); expect(compute()).toBe("1");
  expect(host.querySelectorAll(".event-demo-device")).toHaveLength(2);
  expect(host.textContent).not.toContain("Guest 02"); expect(host.textContent).toContain("In the app");
});
it("removes departed guests and updates Play/Pause without reload or resetting inference totals", async () => {
  f.network.mockResolvedValueOnce(snapshot([device(1), device(2)]))
    .mockResolvedValueOnce(snapshot([device(1, true, true, true), device(2, false)]))
    .mockResolvedValueOnce(snapshot([device(1, true), device(2, false)]))
    .mockResolvedValue(snapshot([device(1, false), device(2, false)]));
  await mount(); expect(count()).toBe("2"); await tick(); expect(count()).toBe("1"); expect(compute()).toBe("1");
  expect(host.textContent).toContain("Running inference"); await tick(); expect(count()).toBe("1"); expect(compute()).toBe("0");
  await tick(); expect(count()).toBe("0"); expect(host.textContent).toContain("No one is connected right now.");
  expect(host.textContent).toContain("Verified inference7");
});
it("does not present old guests as live during connection failure and recovers automatically", async () => {
  f.network.mockResolvedValueOnce(snapshot([device(1)])).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(snapshot([device(2)]));
  await mount(); await tick(); expect(count()).toBe("—"); expect(compute()).toBe("—");
  expect(host.querySelectorAll(".event-demo-device")).toHaveLength(0);
  expect(host.querySelector('.event-demo-live')?.getAttribute('data-online')).toBe("false");
  await tick(); expect(count()).toBe("1"); expect(host.textContent).toContain("Guest 02");
});
it("shows no online guests once the event closes even if the last heartbeat was recent", async () => {
  f.network.mockResolvedValue(snapshot([device(1)], false)); await mount();
  expect(count()).toBe("0"); expect(host.querySelectorAll(".event-demo-device")).toHaveLength(0);
  expect(host.textContent).toContain("This event is closed.");
});
