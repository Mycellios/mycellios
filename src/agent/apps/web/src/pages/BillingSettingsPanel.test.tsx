// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ status: vi.fn(), portal: vi.fn() }));
const translate = vi.hoisted(() => (p: TemplateStringsArray) => p.join(""));
vi.mock("../lib/rpc", () => ({ rpc: { billing: api } }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: translate, i18n: { locale: "en" } }),
  Trans: ({ children }: { children: ReactNode }) => children,
  Plural: () => null,
}));
vi.mock("../components/ModelCredits", () => ({ ModelCreditsSettings: () => <p data-testid="model-credit-controls">Credit controls</p> }));
vi.mock("./settings/BillingServers", () => ({ BillingServers: () => <p>Servers</p> }));

import { BillingSettingsPanel } from "./BillingSettingsPanel";

const status = {
  access: true,
  canManage: true,
  trialAvailable: false,
  trialDays: 0,
  state: "active",
  price: null,
  seats: 1,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  cancelAtPeriodEnd: false,
  hasCustomer: true,
};
it("recovers a failed read without starting checkout and shows a portal error without navigating", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.status.mockReset().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(status);
  api.portal.mockReset().mockRejectedValue(new Error("offline"));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BillingSettingsPanel />));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    expect(api.status).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("Active");
    expect(api.portal).not.toHaveBeenCalled();
    const manage = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Manage",
    );
    await act(async () => manage!.click());
    expect(api.portal).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not open billing");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps disabled billing visible without reading or starting payment flows", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); api.status.mockClear(); api.portal.mockClear();
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<BillingSettingsPanel enabled={false} />));
    expect(host.textContent).toContain("Payments are not enabled"); expect(host.textContent).toContain("Servers");
    expect(api.status).not.toHaveBeenCalled(); expect(api.portal).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
it("preserves model-credit controls and hides billing changes from members", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); api.status.mockResolvedValue({ ...status, funding: "credits", canManage: false }); api.portal.mockClear();
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<BillingSettingsPanel />));
    expect(host.querySelector('[data-testid="model-credit-controls"]')).not.toBeNull();
    expect(host.textContent).toContain("Only the account owner"); expect([...host.querySelectorAll("button")].some(button => button.textContent === "Manage")).toBe(false);
    expect(api.portal).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
it.each(["paused", "unpaid", "incomplete"])("shows the real %s state without a renewal claim", async state => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); api.status.mockResolvedValue({ ...status, state, currentPeriodEndsAt: "2026-12-01T00:00:00Z" });
  const host = document.createElement("div"), root = createRoot(host); document.body.append(host);
  try {
    await act(async () => root.render(<BillingSettingsPanel />));
    expect(host.textContent).toContain(state[0]!.toUpperCase() + state.slice(1)); expect(host.textContent).not.toContain("Renews");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
