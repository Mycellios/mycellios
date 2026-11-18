// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AccountPlanLimit } from "@rakazo/contracts";
const mocks = vi.hoisted(() => ({ planLimits: vi.fn(), native: vi.fn() }));
vi.mock("../lib/space-rpc", () => { const rpc = { models: { planLimits: mocks.planLimits }, engines: { codexQuota: mocks.native } }; return { useSpaceRpc: () => rpc }; });
vi.mock("@lingui/react/macro", () => ({ useLingui: () => ({ t: (parts: TemplateStringsArray, ...values: unknown[]) => parts.reduce((s, part, i) => `${s}${i ? values[i - 1] : ""}${part}`, ""), i18n: { locale: "en" } }) }));
vi.mock("@rakazo/ui-web", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTitle: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => <h2 {...props}>{children}</h2>,
  PopoverContent: ({ children, className }: { children: ReactNode; className: string }) => <div className={className}>{children}</div>,
  PopoverTrigger: ({ openOnHover: _, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { openOnHover: boolean }) => <button {...props} />,
  Button: ({ variant: _, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant: string }) => <button {...props} />,
}));
import { ProviderQuota, railRings } from "./ProviderQuota";
let root: Root, container: HTMLDivElement;
const usage = vi.fn(), models = vi.fn();
function account(): AccountPlanLimit { return { credentialId: "native:codex", provider: "openai-codex", label: "ChatGPT", authKind: "oauth", plan: "plus", status: "available", checkedAt: new Date().toISOString(), measuredAt: new Date().toISOString(), retryAt: null, reason: null, windows: [{ id: "weekly", label: "Weekly", usedPercent: 8, durationMinutes: 10080, resetsAt: new Date(Date.now() + 6 * 86400000).toISOString(), model: null }] }; }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); localStorage.clear(); usage.mockClear(); models.mockClear(); mocks.planLimits.mockReset().mockResolvedValue({ accounts: [], checkedAt: new Date().toISOString() }); mocks.native.mockReset().mockResolvedValue(null); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<ProviderQuota scope="user/space" onModels={models} onUsage={usage} />)); }
it("shows native ChatGPT's real remaining allowance and logo, and navigates on click", async () => {
  mocks.native.mockResolvedValue(account()); await render();
  expect(container.textContent).toContain("92% remaining");
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("92");
  expect(container.querySelector('img[src$="openai-black.svg"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Manage model accounts");
  act(() => container.querySelector<HTMLButtonElement>('[data-testid="provider-quota-trigger"]')!.click()); expect(usage).toHaveBeenCalledOnce();
});
it("keeps saved account quotas when the native host is unavailable", async () => {
  mocks.native.mockRejectedValue(new Error("unsupported host")); mocks.planLimits.mockResolvedValue({ accounts: [account()] }); await render();
  expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("92");
});
it("never presents an expired measurement as fresh remaining quota", async () => {
  mocks.native.mockResolvedValue({ ...account(), measuredAt: new Date(Date.now() - 121000).toISOString() }); await render();
  expect(container.querySelector('[role="progressbar"]')?.hasAttribute("aria-valuenow")).toBe(false);
  expect(container.textContent).toContain("Awaiting refresh");
});
it("shows one rail ring for every account that reports quota, like Codex and Claude together", async () => {
  const claude = { ...account(), credentialId: "claude-oauth", provider: "anthropic", label: "Claude" };
  const unmeasured = { ...account(), credentialId: "stale", measuredAt: new Date(Date.now() - 121000).toISOString() };
  mocks.native.mockResolvedValue(account()); mocks.planLimits.mockResolvedValue({ accounts: [claude, unmeasured] }); await render();
  const trigger = container.querySelector('[data-testid="provider-quota-trigger"]')!;
  expect(trigger.querySelectorAll('[data-testid="provider-quota-ring"]').length).toBe(2);
  expect(trigger.querySelector('img[src$="openai-black.svg"]')).not.toBeNull();
  expect(trigger.querySelector('[data-testid="provider-quota-more"]')).toBeNull();
});
it("keeps the accounts with the least left and counts the rest when the rail is full", () => {
  const rows = [90, 10, 50, 70, 30].map((used, i) => ({ ...account(), credentialId: `a${i}`, windows: [{ ...account().windows[0]!, usedPercent: used }] }));
  const { shown, more } = railRings(rows, Date.now());
  expect(shown.map((row) => row.credentialId)).toEqual(["a0", "a2", "a3"]);
  expect(more).toBe(2);
});
it("provides account setup without inventing an allowance for an API key", async () => {
  mocks.planLimits.mockResolvedValue({ accounts: [{ ...account(), status: "unsupported", windows: [] }] }); await render();
  expect(container.querySelector('[role="progressbar"]')).toBeNull();
  const setup = [...container.querySelectorAll('button')].find(b => b.textContent === "Manage model accounts")!;
  act(() => setup.click()); expect(models).toHaveBeenCalledOnce();
});
