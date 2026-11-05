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
vi.mock("../components/ModelCredits", () => ({ ModelCreditsSettings: () => null }));

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
