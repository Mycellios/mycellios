// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RpcClient } from "../../lib/rpc";
import { profileReport } from "./profile-test-fixture";
const state = vi.hoisted(() => ({ client: {} as RpcClient }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => state.client }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, text, i) => out + text + (v[i] ?? ""), ""), i18n: { locale: "en" } }) }));
import { ProfileOverview } from "./ProfileOverview";
let root: Root, el: HTMLDivElement;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); el = document.createElement("div"); document.body.append(el); root = createRoot(el); });
afterEach(async () => { await act(async () => root.unmount()); el.remove(); vi.restoreAllMocks(); });
async function render(onEdit = vi.fn()) { await act(async () => root.render(<ProfileOverview name="Jamie" accountId="owner" bots={[]} timezone="UTC" onEdit={onEdit} />)); }
it("renders real aggregates, an accessible year and working edit action", async () => {
  const dashboard = vi.fn(async () => profileReport()); state.client = { usage: { dashboard } } as unknown as RpcClient;
  const edit = vi.fn(); await render(edit);
  expect(el.textContent).toContain("Messages"); expect(el.textContent).toContain("14"); expect(el.textContent).toContain("Model"); expect(el.textContent).toContain("Activity in this space");
  expect(el.querySelectorAll(".rk-profile-heat button")).toHaveLength(365);
  expect(el.querySelectorAll('.rk-profile-heat button[tabindex="0"]')).toHaveLength(1);
  await act(async () => [...el.querySelectorAll("button")].find(b => b.textContent?.includes("Edit profile"))!.click()); expect(edit).toHaveBeenCalledOnce();
  expect(dashboard).toHaveBeenCalledWith(expect.objectContaining({ timeZone: "UTC" }));
});
it("shows a retryable error and keeps share disabled until real data arrives", async () => {
  const dashboard = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(profileReport()); state.client = { usage: { dashboard } } as unknown as RpcClient;
  await render(); expect(el.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
  expect([...el.querySelectorAll("button")].find(b => b.textContent === "Share activity")!.disabled).toBe(true);
  await act(async () => [...el.querySelectorAll("button")].find(b => b.textContent === "Retry")!.click()); expect(el.querySelector(".rk-profile-tiles")).not.toBeNull();
});
it("does not display old account/Space metrics or accept late results after switching clients", async () => {
  let resolve!: (data: ReturnType<typeof profileReport>) => void;
  state.client = { usage: { dashboard: () => new Promise(r => { resolve = r; }) } } as unknown as RpcClient;
  await render(); state.client = { usage: { dashboard: () => new Promise(() => {}) } } as unknown as RpcClient; await render();
  await act(async () => resolve(profileReport())); expect(el.querySelector(".rk-profile-tiles")).toBeNull(); expect(el.textContent).not.toContain("14");
});
it("image preparation failures stay visible and do not publish anything", async () => {
  state.client = { usage: { dashboard: async () => profileReport() } } as unknown as RpcClient;
  vi.stubGlobal("Image", class { set src(_: string) {} decode() { return Promise.reject(new Error("decode")); } });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") }); Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  await render(); await act(async () => [...el.querySelectorAll("button")].find(b => b.textContent === "Share activity")!.click());
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("Could not prepare"); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"); vi.unstubAllGlobals();
});
