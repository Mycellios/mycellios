// @vitest-environment jsdom
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { BillingStatus } from "@rakazo/contracts";
import { expect, it, vi } from "vitest";

vi.mock("../lib/rpc", () => ({ rpc: { billing: {} } }));
vi.mock("../lib/sign-out", () => ({ useSignOut: () => ({ logOut: vi.fn(), signingOut: false }) }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, p, i) => a + p + (v[i] ?? ""), ""), i18n: { locale: "en" } }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => {
  const Wrapper = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return Object.fromEntries(["Button", "Card", "CardContent", "CardFooter", "CardHeader", "Dialog", "DialogContent", "DialogDescription", "DialogHeader", "DialogTitle", "Select", "SelectContent", "SelectGroup", "SelectItem", "SelectTrigger", "SelectValue", "Separator"].map(name => [name, Wrapper]));
});
import { ModelCreditsSettings } from "./ModelCredits";

it.each([[10, "10.00"], [0.954188, "0.954188"]])("displays paid balance %s as credits with its original precision", async (balanceUsd, expected) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    const status = { balanceUsd, canManage: false, funding: "credits", state: "none" } as BillingStatus;
    await act(async () => root.render(<ModelCreditsSettings status={status} refresh={async () => {}} />));
    expect(host.querySelector(".tabular-nums")?.textContent).toBe(expected);
    expect(host.textContent).toContain("Adding 10 USD gives you 10 credits");
    expect(host.textContent).toContain("Spore is a separate token");
    expect(host.querySelector(".tabular-nums")?.textContent).not.toContain("$");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
