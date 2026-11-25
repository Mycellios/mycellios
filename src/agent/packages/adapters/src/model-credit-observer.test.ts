import type { ModelCallObserver } from "@mycellios/adapter-kit";
import {
  creditAccount,
  organizationForMember,
  reserveModelCredits,
  sharedMicoAllowance,
} from "@mycellios/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hostedModelCreditObserver } from "./model-credit-observer.js";

vi.mock("@mycellios/db", () => ({
  organizationForMember: vi.fn(),
  creditAccount: vi.fn(),
  reserveModelCredits: vi.fn(),
  recordModelCreditReceipt: vi.fn(),
  sharedMicoAllowance: vi.fn(),
  SharedMicoUnavailableError: class extends Error {
    constructor() {
      super("This Mico is no longer shared with you.");
    }
  },
}));

const scope = { userId: "user-1", spaceId: "space-1" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(organizationForMember).mockResolvedValue({ organizationId: "org-1" } as never);
});

describe("hosted model credit gate", () => {
  it("refuses BYOK accounts even if old owner and subscription records exist", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "byok" } as never);
    const findUnique = vi.fn(async () => ({ ownerUserId: scope.userId, status: "active" }));
    await expect(
      hostedModelCreditObserver(
        { deploymentSettings: { findUnique }, billingAccount: { findUnique } } as never,
        scope,
      ),
    ).rejects.toThrow("Connect your own API key");
    expect(findUnique).not.toHaveBeenCalled();
    expect(reserveModelCredits).not.toHaveBeenCalled();
  });
  it("requires a reservation before a funded-mode account may use the server key", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    vi.mocked(reserveModelCredits).mockRejectedValue(new Error("Not enough model credits"));
    const observer = await hostedModelCreditObserver({} as never, scope);
    const call = {
      callId: "call-1",
      maxCostUsd: 0.02,
      provider: "test-provider",
      modelId: "test-model",
      runId: "run-1",
    } as Parameters<ModelCallObserver["beforeCall"]>[0];
    await expect(observer.beforeCall(call)).rejects.toThrow("Not enough model credits");
    expect(reserveModelCredits).toHaveBeenCalledWith({}, "org-1", 0.02, {
      ...scope,
      callId: "call-1",
      runId: "run-1",
      provider: "test-provider",
      model: "test-model",
    });
  });

  it("admits a Space member's call on a shared Mico against their allowance, on the owner's account", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    const allowance = { memberUserId: "ben", botId: "bot-1", limitMicros: 1_000_000n, since: new Date(0) };
    vi.mocked(sharedMicoAllowance).mockResolvedValue(allowance);
    vi.mocked(reserveModelCredits).mockResolvedValue("hold-1");
    const prisma = {} as never;
    const observer = await hostedModelCreditObserver(prisma, scope, {
      userId: "ben",
      botId: "bot-1",
      runId: "run-9",
    });
    const call = {
      callId: "call-2",
      maxCostUsd: 0.05,
      provider: "test-provider",
      modelId: "test-model",
    } as Parameters<ModelCallObserver["beforeCall"]>[0];
    await expect(observer.beforeCall(call)).resolves.toBe("hold-1");
    expect(sharedMicoAllowance).toHaveBeenCalledWith(prisma, {
      spaceId: "space-1",
      memberUserId: "ben",
      botId: "bot-1",
    });
    expect(reserveModelCredits).toHaveBeenCalledWith(
      prisma,
      "org-1",
      0.05,
      {
        ...scope,
        callId: "call-2",
        runId: "run-9",
        provider: "test-provider",
        model: "test-model",
        requestedByUserId: "ben",
      },
      undefined,
      allowance,
    );
  });

  it("refuses a member's call once the Mico is no longer shared with them, before any hold", async () => {
    vi.mocked(creditAccount).mockResolvedValue({ mode: "credits" } as never);
    vi.mocked(sharedMicoAllowance).mockResolvedValue(null);
    const observer = await hostedModelCreditObserver({} as never, scope, {
      userId: "ben",
      botId: "bot-1",
      runId: "run-9",
    });
    await expect(
      observer.beforeCall({
        callId: "call-3",
        maxCostUsd: 0.01,
        provider: "test-provider",
        modelId: "test-model",
      } as Parameters<ModelCallObserver["beforeCall"]>[0]),
    ).rejects.toThrow("no longer shared");
    expect(reserveModelCredits).not.toHaveBeenCalled();
  });
});
