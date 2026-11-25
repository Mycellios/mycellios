import type { ModelCallObserver } from "@mycellios/adapter-kit";
import { HOSTED_MODEL_CREDITS_REQUIRED_ERROR } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import {
  creditAccount,
  organizationForMember,
  recordModelCreditReceipt,
  reserveModelCredits,
} from "@mycellios/db";

export class HostedModelCreditsRequiredError extends Error {}

/** Only deployment credentials are metered; a personal connection never reaches this boundary. */
export async function hostedModelCreditObserver(
  prisma: PrismaClient,
  scope: { userId: string; spaceId: string },
  desktopTool?: { botId: string; leaseOwner: string; leaseFence: number },
): Promise<ModelCallObserver> {
  const membership = await organizationForMember(prisma, scope);
  if (!membership || (desktopTool && !membership.isOwner)) throw new Error("Model credit account is unavailable");
  const account = await creditAccount(prisma, membership.organizationId);
  if (account.mode !== "credits")
    throw new HostedModelCreditsRequiredError(HOSTED_MODEL_CREDITS_REQUIRED_ERROR);
  return {
    beforeCall: (call) =>
      reserveModelCredits(prisma, membership.organizationId, call.maxCostUsd ?? Number.NaN, {
        callId: call.callId,
        userId: scope.userId,
        spaceId: scope.spaceId,
        runId: call.runId,
        provider: call.provider,
        model: call.modelId,
        ...(desktopTool ? { desktopTool } : {}),
      }),
    afterCall: (reservationId, usage) => recordModelCreditReceipt(prisma, reservationId, usage),
    onRequestId: async (id, providerRequestId) => {
      await prisma.modelCreditEntry.updateMany({
        where: { id, providerRequestId: null },
        data: { providerRequestId },
      });
    },
  };
}
