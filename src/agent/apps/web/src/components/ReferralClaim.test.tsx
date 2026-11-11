// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { redeem, client } = vi.hoisted(() => { const redeem = vi.fn(); return { redeem, client: { referrals: { redeem } } }; });
vi.mock("../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
import { ReferralClaim } from "./ReferralClaim";
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); redeem.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function rendered(check: (root: ReturnType<typeof createRoot>) => Promise<void>) {
  const host = document.createElement("div"); const root = createRoot(host);
  try { await act(async () => root.render(<ReferralClaim userId="owner" />)); await check(root); }
  finally { await act(async () => root.unmount()); }
}
it("retries a lost response and refreshes the authoritative balance after idempotent recovery", async () => {
  vi.useFakeTimers(); redeem.mockRejectedValueOnce(new Error("response lost")).mockResolvedValue({ status: "already_awarded" });
  const changed = vi.fn(); window.addEventListener("mycellios:credits-changed", changed);
  try { await rendered(async () => {
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(redeem).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenCalledTimes(1);
    expect(redeem.mock.calls[0]?.[0]).toEqual({ expectedUserId: "owner" });
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(redeem).toHaveBeenCalledTimes(2);
  }); } finally { window.removeEventListener("mycellios:credits-changed", changed); }
});
it("keeps the invitation pending until email verification and never invents a reward", async () => {
  redeem.mockResolvedValueOnce({ status: "verification_required" }).mockResolvedValue({ status: "not_eligible" });
  const changed = vi.fn(); window.addEventListener("mycellios:credits-changed", changed);
  try { await rendered(async () => {
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(redeem).toHaveBeenCalledTimes(2); expect(changed).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(redeem).toHaveBeenCalledTimes(2);
  }); } finally { window.removeEventListener("mycellios:credits-changed", changed); }
});
it("aborts the old account and claims only for the new account after switching", async () => {
  redeem.mockImplementation(async () => ({ status: "no_referral" }));
  await rendered(async root => {
    const oldSignal = redeem.mock.calls[0]?.[1].signal as AbortSignal;
    await act(async () => root.render(<ReferralClaim userId="other" />));
    expect(oldSignal.aborted).toBe(true);
    expect(redeem.mock.calls[1]?.[0]).toEqual({ expectedUserId: "other" });
  });
});
