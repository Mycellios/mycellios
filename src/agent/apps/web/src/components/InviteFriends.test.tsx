// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { invite, client } = vi.hoisted(() => { const invite = vi.fn(); return { invite, client: { referrals: { invite } } }; });
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
vi.mock("./IconTooltip", () => ({ IconTooltip: ({ children }: { children: ReactNode }) => children }));
import { InviteFriends } from "./InviteFriends";
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); invite.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => vi.unstubAllGlobals());
const code = "i".repeat(43);
const verified = { link: `https://www.mycellios.com/v1/referrals/visit/${code}`, rewardMicrounits: 1000000, rewardDays: 14, rewardedInvites: 2 };
async function opened(check: () => Promise<void>) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<InviteFriends userId="owner" />));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Invitar amigos"]')!.click());
    await check();
  } finally { await act(async () => root.unmount()); host.remove(); }
}
it("copies the personal link returned by the authority and explains the real award and expiry", async () => {
  invite.mockResolvedValue(verified); const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await opened(async () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("1 crédito promocional para cada uno");
    expect(dialog.textContent).toContain("14 días");
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Enlace de invitación"]')?.value).toBe(verified.link);
    const copy = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent?.includes("Copiar enlace"))!;
    await act(async () => copy.click()); expect(writeText).toHaveBeenCalledWith(verified.link);
    expect(dialog.textContent).toContain("Enlace copiado");
  });
});
it("shows an honest retry when unavailable, with no generic signup URL or copy action", async () => {
  invite.mockRejectedValue(new Error("not deployed"));
  await opened(async () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("todavía no está disponible");
    expect(dialog.querySelector("input")).toBeNull(); expect(dialog.textContent).not.toContain("Copiar enlace");
    invite.mockResolvedValue(verified);
    const retry = Array.from(dialog.querySelectorAll("button")).find(button => button.textContent === "Reintentar")!;
    await act(async () => retry.click()); expect(dialog.querySelector("input")).not.toBeNull();
  });
});
