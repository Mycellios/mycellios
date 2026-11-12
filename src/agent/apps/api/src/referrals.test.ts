import { createRouterClient } from "@orpc/server";
import { expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";
const code = "r".repeat(43), receipt = "v".repeat(43);
const invite = { code, link: `https://www.mycellios.com/v1/referrals/visit/${code}`, rewardMicrounits: 1000000, rewardDays: 14, rewardedInvites: 0 };
function fixture(cookie?: string, enabled = true) {
  const token = vi.fn(async () => "verified-oauth-access-token");
  const transport = vi.fn<typeof fetch>(async url => Response.json(String(url).endsWith("/invite") ? invite : { status: "awarded", rewardMicrounits: 1000000, expiresAt: Date.now() + 86400000 }));
  const deps = { auth: { oidcAccessToken: token }, modelConnectionFetch: transport, env: { mycelliosSso: enabled, sandboxProvider: "fake" } } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: {
    actor: { userId: "owner", spaceId: "space", email: "owner@example.test" },
    requestHeaders: new Headers(cookie ? { cookie } : {}),
  } as never });
  return { client, transport, token };
}
it("uses the verified owner's OAuth session and only the fixed reward authority", async () => {
  const f = fixture(); expect(await f.client.referrals.invite({ expectedUserId: "owner" })).toEqual(invite);
  expect(f.token).toHaveBeenCalledWith(expect.any(Headers), "owner");
  expect(f.transport).toHaveBeenCalledWith("https://www.mycellios.com/v1/referrals/invite", expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store" }));
  expect(new Headers(f.transport.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer verified-oauth-access-token");
});
it("rejects a stale account before fetching tokens or awarding anything", async () => {
  const f = fixture(`mycellios_referral_v1=${receipt}`);
  await expect(f.client.referrals.redeem({ expectedUserId: "someone-else" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.token).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled();
});
it("preserves the HttpOnly visit receipt without accepting a browser-supplied beneficiary or amount", async () => {
  const f = fixture(`other=ignore; mycellios_referral_v1=${receipt}`);
  expect((await f.client.referrals.redeem({ expectedUserId: "owner" })).status).toBe("awarded");
  expect(new Headers(f.transport.mock.calls[0]![1]?.headers).get("x-mycellios-referral-visit")).toBe(receipt);
  expect(f.transport.mock.calls[0]![1]?.body).toBeUndefined();
  await expect(f.client.referrals.redeem({ expectedUserId: "owner", amount: 9000 } as never)).rejects.toThrow();
});
it.each([undefined, "mycellios_referral_v1=forged", `mycellios_referral_v1=${receipt}; mycellios_referral_v1=${receipt}`])("recovers account-bound attribution without forwarding a missing or ambiguous cookie: %s", async cookie => {
  const f = fixture(cookie); expect((await f.client.referrals.redeem({ expectedUserId: "owner" })).status).toBe("awarded");
  expect(new Headers(f.transport.mock.calls[0]![1]?.headers).get("x-mycellios-referral-visit")).toBeNull();
});
it("does not turn a missing feature or expired session into a usable invitation", async () => {
  const disabled = fixture(undefined, false);
  await expect(disabled.client.referrals.invite({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(disabled.transport).not.toHaveBeenCalled();
  const denied = fixture(); denied.transport.mockResolvedValue(new Response(null, { status: 403 }));
  await expect(denied.client.referrals.invite({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("rejects an invitation URL outside the fixed canonical origin or its matching code", async () => {
  for (const link of ["https://attacker.test/signup", "https://www.mycellios.com/agent/sign-up"]) {
    const f = fixture(); f.transport.mockResolvedValue(Response.json({ ...invite, link }));
    await expect(f.client.referrals.invite({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  }
});
