import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_ACCOUNT_URL,
  AGENT_API_KEYS_URL,
  AGENT_API_PLAN_URL,
  AGENT_API_USAGE_URL,
  legacyAccountRedirect,
} from "../src/contracts/agent-account-links.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { BillingCheckoutError, BillingCheckoutService, type StripeCheckoutGateway } from "../src/coordinator/billing-checkout.js";
import { BillingManager } from "../src/coordinator/billing.js";
import { MeshDatabase } from "../src/storage/database.js";

const unusedGateway = {} as StripeCheckoutGateway;
let database: MeshDatabase | undefined;
afterEach(async () => { await database?.close(); database = undefined; });

async function checkoutWith(urls: { successUrl: string; cancelUrl: string; portalReturnUrl: string }) {
  database = await MeshDatabase.open(":memory:");
  const billing = new BillingManager(database, new ApiAccessManager(database, {
    starterTokens: 0, requestsPerMinute: 30, maxConcurrent: 2, maxActiveKeys: 10,
  }));
  return new BillingCheckoutService(database, billing, unusedGateway, {
    planId: "mycellios-go", planVersion: 1, subscriptionPriceId: "price_go_1", topUpPacks: [], ...urls,
  });
}

describe("Mycellios Go return URLs in the Agent account", () => {
  it("brings the coordinator's configured dashboard returns back to the Agent API plan", () => {
    // These are the dashboard URLs the coordinator is configured with today.
    expect(legacyAccountRedirect("/account", "?checkout=success")).toBe(`${AGENT_API_PLAN_URL}&apiCheckout=success`);
    expect(legacyAccountRedirect("/account", "?checkout=cancelled")).toBe(`${AGENT_API_PLAN_URL}&apiCheckout=cancelled`);
    expect(legacyAccountRedirect("/account", "")).toBe(AGENT_API_PLAN_URL);
  });

  it("produces only return URLs that the coordinator's own validation accepts", async () => {
    await expect(checkoutWith({
      successUrl: legacyAccountRedirect("/account", "?checkout=success")!,
      cancelUrl: legacyAccountRedirect("/account", "?checkout=cancelled")!,
      portalReturnUrl: legacyAccountRedirect("/account", "")!,
    })).resolves.toBeInstanceOf(BillingCheckoutService);
    await expect(checkoutWith({
      successUrl: "http://www.mycellios.com/agent/app?settings=api-plan",
      cancelUrl: AGENT_API_PLAN_URL,
      portalReturnUrl: AGENT_API_PLAN_URL,
    })).rejects.toBeInstanceOf(BillingCheckoutError);
  });

  it("maps every legacy tab to a fixed first-party Agent section and ignores other input", () => {
    expect(legacyAccountRedirect("/account/", "?tab=api")).toBe(AGENT_API_KEYS_URL);
    expect(legacyAccountRedirect("/account", "?tab=usage")).toBe(AGENT_API_USAGE_URL);
    expect(legacyAccountRedirect("/account", "?tab=billing&checkout=success")).toBe(`${AGENT_API_PLAN_URL}&apiCheckout=success`);
    expect(legacyAccountRedirect("/account", "?tab=account")).toBe(AGENT_ACCOUNT_URL);
    expect(legacyAccountRedirect("/dashboard", "?tab=usage")).toBeNull();
    for (const search of ["?checkout=//attacker.example", "?checkout=success%26next%3Dhttps://attacker.example", "?tab=%2F%2Fattacker.example", "?next=https://attacker.example"]) {
      const target = new URL(legacyAccountRedirect("/account", search)!);
      expect(target.origin).toBe("https://www.mycellios.com");
      expect(target.pathname).toBe("/agent/app");
      expect([...target.searchParams.keys()].every((key) => key === "settings" || key === "apiCheckout")).toBe(true);
      expect(["success", "cancelled", null]).toContain(target.searchParams.get("apiCheckout"));
    }
  });
});
