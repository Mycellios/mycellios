import { createRouterClient } from "@orpc/server";
import { isStripeRedirect } from "@mycellios/contracts";
import { describe, expect, it, vi } from "vitest";
import { createRouter, type RouterDeps } from "./router.js";

const API = "https://www.mycellios.com/v1";
const SESSION = "fixture-oidc-session";
const billingAccount = {
  object: "billing_account",
  checkoutAvailable: true,
  portalAvailable: false,
  topUpsAvailable: false,
  tokenDebt: 0,
  plan: { id: "mycellios-go", version: 1, currency: "EUR", amountMicros: 10_000_000, includedTokens: 5_000_000, status: "active" },
  subscription: null,
};
const apiAccount = {
  object: "account", user_id: "owner", token_balance: 42_000, usd_balance: "0", lifetime_input_tokens: 1_200,
  lifetime_output_tokens: 800, request_count: 3, limits: {}, created_at: "x", updated_at: "x",
};
const usageRow = (id: string, model: string, total: number) => ({
  id, model, input_tokens: total - 10, output_tokens: 10, total_tokens: total, status: "completed",
  created_at: "2026-11-20T10:00:00.000Z", completed_at: "2026-11-20T10:00:01.000Z",
});

function fixture({ sso = true, checkoutUrl = "https://checkout.stripe.com/c/pay/cs_test_1" } = {}) {
  const token = vi.fn(async () => SESSION);
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).slice(API.length);
    const method = init?.method ?? "GET";
    if (path === "/billing/account" && method === "GET") return Response.json(billingAccount);
    if (path === "/account" && method === "GET") return Response.json(apiAccount);
    if (path === "/account/usage?limit=50" && method === "GET")
      return Response.json({ object: "list", data: [usageRow("u1", "model-a", 100), usageRow("u2", "model-b", 50)] });
    if (path === "/billing/checkout/subscription" && method === "POST")
      return Response.json({ object: "billing_checkout_session", id: "cs_test_1", url: checkoutUrl, duplicate: false }, { status: 201 });
    if (path === "/billing/portal" && method === "POST")
      return Response.json({ object: "billing_portal_session", id: "bps_1", url: "https://billing.stripe.com/p/session/bps_1", duplicate: false }, { status: 201 });
    return new Response("unexpected", { status: 500 });
  });
  const deps = {
    auth: { oidcAccessToken: token },
    modelConnectionFetch: transport,
    env: { mycelliosSso: sso, sandboxProvider: "fake" },
  } as unknown as RouterDeps;
  const client = createRouterClient(createRouter(deps), { context: {
    actor: { userId: "owner", spaceId: "space", email: "owner@example.test" },
    requestHeaders: new Headers(),
  } as never });
  return { client, transport, token };
}

const subscriptionKey = "mycellios-subscription-0b5c8a7e-1111-4f6a-9a40-7d3c2e1f0a99";
const portalKey = "mycellios-portal-0b5c8a7e-2222-4f6a-9a40-7d3c2e1f0a99";

describe("Mycellios API subscription and usage in the Agent account", () => {
  it("reads the plan with the owner's server-side session and never returns the token", async () => {
    const f = fixture();
    const plan = await f.client.mycelliosApiBilling.plan({ expectedUserId: "owner" });
    expect(f.token).toHaveBeenCalledWith(expect.any(Headers), "owner");
    for (const [url, init] of f.transport.mock.calls) {
      expect(String(url).startsWith(API)).toBe(true);
      expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${SESSION}`);
    }
    expect(plan).toEqual({
      checkoutAvailable: true, portalAvailable: false, tokenDebt: 0, tokenBalance: 42_000,
      plan: { currency: "EUR", amountMicros: 10_000_000, includedTokens: 5_000_000, status: "active" },
      subscription: null,
    });
    expect(JSON.stringify(plan)).not.toContain(SESSION);
  });

  it("shows an unavailable balance instead of zero when the account read fails", async () => {
    const f = fixture();
    f.transport.mockImplementation(async (url) => String(url).endsWith("/billing/account")
      ? Response.json(billingAccount)
      : new Response("down", { status: 503 }));
    expect((await f.client.mycelliosApiBilling.plan({ expectedUserId: "owner" })).tokenBalance).toBeNull();
  });

  it("reads the last 50 API requests and lifetime totals", async () => {
    const f = fixture();
    const usage = await f.client.mycelliosApiBilling.usage({ expectedUserId: "owner" });
    expect(f.transport.mock.calls.map(([url]) => String(url))).toContain(`${API}/account/usage?limit=50`);
    expect(usage.totals).toEqual({ requestCount: 3, inputTokens: 1_200, outputTokens: 800 });
    expect(usage.requests.map((entry) => [entry.model, entry.totalTokens])).toEqual([["model-a", 100], ["model-b", 50]]);
    expect(JSON.stringify(usage)).not.toContain(SESSION);
  });

  it("starts checkout and the portal with the browser's idempotency key and only returns Stripe pages", async () => {
    const f = fixture();
    expect(await f.client.mycelliosApiBilling.checkout({ expectedUserId: "owner", idempotencyKey: subscriptionKey }))
      .toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const [url, init] = f.transport.mock.calls.at(-1)!;
    expect(url).toBe(`${API}/billing/checkout/subscription`);
    expect(init).toMatchObject({ method: "POST", body: "{}", redirect: "error" });
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(subscriptionKey);
    expect(await f.client.mycelliosApiBilling.portal({ expectedUserId: "owner", idempotencyKey: portalKey }))
      .toEqual({ url: "https://billing.stripe.com/p/session/bps_1" });
    expect(new Headers(f.transport.mock.calls.at(-1)![1]?.headers).get("idempotency-key")).toBe(portalKey);
  });

  it("refuses a checkout destination outside Stripe", async () => {
    const f = fixture({ checkoutUrl: "https://checkout.stripe.com.example.net/phish" });
    await expect(f.client.mycelliosApiBilling.checkout({ expectedUserId: "owner", idempotencyKey: subscriptionKey }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("rejects malformed or mismatched idempotency keys before calling the coordinator", async () => {
    const f = fixture();
    await expect(f.client.mycelliosApiBilling.checkout({ expectedUserId: "owner", idempotencyKey: portalKey })).rejects.toBeDefined();
    await expect(f.client.mycelliosApiBilling.portal({ expectedUserId: "owner", idempotencyKey: "retry" })).rejects.toBeDefined();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.token).not.toHaveBeenCalled();
  });

  it("rejects another account and signed-out SSO before reading a token", async () => {
    const f = fixture();
    await expect(f.client.mycelliosApiBilling.plan({ expectedUserId: "someone-else" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(f.client.mycelliosApiBilling.checkout({ expectedUserId: "someone-else", idempotencyKey: subscriptionKey }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    const g = fixture({ sso: false });
    await expect(g.client.mycelliosApiBilling.usage({ expectedUserId: "owner" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.token).not.toHaveBeenCalled();
    expect(g.transport).not.toHaveBeenCalled();
  });

  it("maps an existing subscription to a conflict without forwarding the upstream body", async () => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(new Response("private upstream diagnostic", { status: 409 }));
    const error = await f.client.mycelliosApiBilling.checkout({ expectedUserId: "owner", idempotencyKey: subscriptionKey })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(String((error as Error).message)).not.toContain("private upstream diagnostic");
  });
});

describe("Stripe destinations", () => {
  it("accepts only Stripe-hosted HTTPS pages of the expected kind", () => {
    expect(isStripeRedirect("https://checkout.stripe.com/c/pay/cs_1", "checkout")).toBe(true);
    expect(isStripeRedirect("https://billing.stripe.com/p/session/1", "portal")).toBe(true);
    expect(isStripeRedirect("https://billing.stripe.com/p/session/1", "checkout")).toBe(false);
    expect(isStripeRedirect("http://checkout.stripe.com/c/pay/cs_1", "checkout")).toBe(false);
    expect(isStripeRedirect("https://user:pass@checkout.stripe.com/c", "checkout")).toBe(false);
    expect(isStripeRedirect("https://evilcheckout.stripe.com.attacker.test/", "checkout")).toBe(false);
    expect(isStripeRedirect("not a url", "portal")).toBe(false);
  });
});
