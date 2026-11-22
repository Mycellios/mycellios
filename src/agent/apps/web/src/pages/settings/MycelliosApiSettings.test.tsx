// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ plan: vi.fn(), usage: vi.fn(), checkout: vi.fn(), portal: vi.fn() }));
// The real hook returns a stable client for the current scope.
const client = vi.hoisted(() => ({ mycelliosApiBilling: rpc }));
vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
vi.mock("../../components/LoadingSkeleton", () => ({ LoadingSkeleton: () => <div role="status">Loading</div> }));
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({
  t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((out, part, i) => out + part + (v[i] ?? ""), ""),
  i18n: { locale: "en" },
}) }));
vi.mock("@mycellios/ui-web", () => ({
  Button: ({ variant, size, ...props }: any) => <button {...props} />,
  Badge: ({ variant, ...props }: any) => <span {...props} />,
}));
import { ApiPlanSettingsPanel, ApiUsageSettingsPanel } from "./MycelliosApiSettings";

const activePlan = { currency: "EUR", amountMicros: 10_000_000, includedTokens: 5_000_000, status: "active" as const };
const overview = (patch: Record<string, unknown> = {}) => ({
  checkoutAvailable: true, portalAvailable: false, tokenDebt: 0, tokenBalance: 42_000,
  plan: activePlan, subscription: null, ...patch,
});

let unmount: (() => Promise<void>) | undefined;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks(); });
afterEach(async () => { await unmount?.(); unmount = undefined; vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
async function render(node: ReactNode) {
  const div = document.createElement("div"); document.body.append(div);
  const root = createRoot(div);
  unmount = async () => { await act(async () => root.unmount()); div.remove(); };
  await act(async () => root.render(node));
  return div;
}
const button = (div: HTMLElement, text: string) => [...div.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

it("explains how the API subscription differs from Agent billing and shows the verified plan", async () => {
  rpc.plan.mockResolvedValue(overview());
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={vi.fn()} />);
  expect(rpc.plan).toHaveBeenCalledWith({ expectedUserId: "owner" });
  expect(div.textContent).toContain("separate from Billing, which covers Mycellios Agent");
  expect(div.textContent).toContain("Mycellios Go");
  expect(div.textContent).toContain("Not subscribed");
  expect(div.textContent).toContain("€10 per month");
  expect(div.textContent).toContain("5M tokens");
  expect(div.textContent).toContain("42,000 tokens");
});

it("never shows a missing balance as zero", async () => {
  rpc.plan.mockResolvedValue(overview({ tokenBalance: null }));
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={vi.fn()} />);
  expect(div.textContent).toContain("API token balanceUnavailable");
});

it("reuses one idempotency key after an uncertain checkout failure and only follows Stripe", async () => {
  rpc.plan.mockResolvedValue(overview());
  rpc.checkout.mockRejectedValueOnce(Object.assign(new Error("down"), { code: "SERVICE_UNAVAILABLE" }))
    .mockResolvedValueOnce({ url: "https://checkout.stripe.com/c/pay/cs_1" });
  const navigate = vi.fn();
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={navigate} />);
  await act(async () => button(div, "Subscribe with Stripe")!.click());
  expect(div.textContent).toContain("Could not open Stripe Checkout");
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => button(div, "Subscribe with Stripe")!.click());
  const [first, second] = rpc.checkout.mock.calls.map(([input]) => input.idempotencyKey);
  expect(first).toMatch(/^mycellios-subscription-[A-Za-z0-9-]{8,96}$/);
  expect(second).toBe(first);
  expect(navigate).toHaveBeenCalledExactlyOnceWith("https://checkout.stripe.com/c/pay/cs_1");
});

it("refuses a non-Stripe destination even if the server returned one", async () => {
  rpc.plan.mockResolvedValue(overview({ subscription: { status: "active", periodEnd: Date.UTC(2026, 11, 20) }, portalAvailable: true }));
  rpc.portal.mockResolvedValue({ url: "https://billing.stripe.com.attacker.test/" });
  const navigate = vi.fn();
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={navigate} />);
  expect(div.textContent).toContain("Active");
  expect(button(div, "Subscribe with Stripe")).toBeUndefined();
  await act(async () => button(div, "Manage the API subscription")!.click());
  expect(rpc.portal.mock.calls[0]![0].idempotencyKey).toMatch(/^mycellios-portal-/);
  expect(navigate).not.toHaveBeenCalled();
  expect(div.textContent).toContain("Could not open the billing portal");
});

it("verifies a Checkout return from the dashboard redirect and removes its marker", async () => {
  window.history.replaceState(null, "", "/agent/app?settings=api-plan&apiCheckout=success");
  rpc.plan.mockResolvedValue(overview());
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={vi.fn()} />);
  expect(div.textContent).toContain("Checking the checkout status");
  expect(window.location.search).toBe("?settings=api-plan");
});

it("shows a read failure with a retry instead of an empty plan", async () => {
  rpc.plan.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "UNAUTHORIZED" })).mockResolvedValueOnce(overview());
  const div = await render(<ApiPlanSettingsPanel accountId="owner" navigate={vi.fn()} />);
  expect(div.textContent).toContain("Your Mycellios session expired");
  expect(div.textContent).not.toContain("Not subscribed");
  await act(async () => button(div, "Retry")!.click());
  expect(div.textContent).toContain("Not subscribed");
});

it("groups the last API requests by model and labels them as key usage", async () => {
  rpc.usage.mockResolvedValue({
    totals: { requestCount: 3, inputTokens: 1_200, outputTokens: 800 },
    requests: [
      { id: "1", model: "model-a", inputTokens: 90, outputTokens: 10, totalTokens: 100, status: "completed", createdAt: "x" },
      { id: "2", model: "model-b", inputTokens: 40, outputTokens: 10, totalTokens: 50, status: "completed", createdAt: "x" },
      { id: "3", model: "model-a", inputTokens: 90, outputTokens: 10, totalTokens: 100, status: "completed", createdAt: "x" },
    ],
  });
  const div = await render(<ApiUsageSettingsPanel accountId="owner" />);
  expect(rpc.usage).toHaveBeenCalledWith({ expectedUserId: "owner" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(div.textContent).toContain("Requests made with your API keys");
  expect(div.textContent).toContain("What your Micos use appears in Profile");
  expect(div.textContent).toContain("Last 50 requests by model");
  expect(div.textContent).toContain("model-aRequests: 2 · Tokens: 200");
  expect(div.textContent).toContain("model-bRequests: 1 · Tokens: 50");
});

it("explains a signed-out account without calling the API", async () => {
  const plan = await render(<ApiPlanSettingsPanel navigate={vi.fn()} />);
  expect(plan.querySelector('[role="alert"]')?.textContent).toContain("sign in with your Mycellios account");
  await unmount?.();
  const usage = await render(<ApiUsageSettingsPanel />);
  expect(usage.querySelector('[role="alert"]')?.textContent).toContain("sign in with your Mycellios account");
  expect(rpc.plan).not.toHaveBeenCalled();
  expect(rpc.usage).not.toHaveBeenCalled();
});
