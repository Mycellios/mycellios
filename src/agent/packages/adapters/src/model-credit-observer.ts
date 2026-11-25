import type { ModelCallObserver } from "@mycellios/adapter-kit";
import { HOSTED_MODEL_CREDITS_REQUIRED_ERROR } from "@mycellios/core";
import type { PrismaClient } from "@mycellios/db";
import {
  creditAccount,
  organizationForMember,
  recordModelCreditReceipt,
  reserveModelCredits,
  SharedMicoUnavailableError,
  sharedMicoAllowance,
} from "@mycellios/db";

export class HostedModelCreditsRequiredError extends Error {}

/**
 * The Space member whose turn on a shared Mico this is (specs/space-members). The Mico's owner
 * pays; each call must still be shared with them and fit their allowance for the UTC day.
 */
export interface ModelCallRequester {
  userId: string;
  botId: string;
  runId: string;
}

/** Only deployment credentials are metered; a personal connection never reaches this boundary. */
export async function hostedModelCreditObserver(
  prisma: PrismaClient,
  scope: { userId: string; spaceId: string },
  requester?: ModelCallRequester,
  desktopTool?: { botId: string; leaseOwner: string; leaseFence: number },
): Promise<ModelCallObserver> {
  const membership = await organizationForMember(prisma, scope);
  if (!membership || (desktopTool && !membership.isOwner)) throw new Error("Model credit account is unavailable");
  const account = await creditAccount(prisma, membership.organizationId);
  if (account.mode !== "credits")
    throw new HostedModelCreditsRequiredError(HOSTED_MODEL_CREDITS_REQUIRED_ERROR);
  return {
    beforeCall: async (call) => {
      const attribution = {
        callId: call.callId,
        userId: scope.userId,
        spaceId: scope.spaceId,
        runId: call.runId,
        provider: call.provider,
        model: call.modelId,
        ...(desktopTool ? { desktopTool } : {}),
      };
      const maxCostUsd = call.maxCostUsd ?? Number.NaN;
      if (!requester)
        return reserveModelCredits(prisma, membership.organizationId, maxCostUsd, attribution);
      // Read again before every paid call: unsharing or removal stops a turn already running.
      const allowance = await sharedMicoAllowance(prisma, {
        spaceId: scope.spaceId,
        memberUserId: requester.userId,
        botId: requester.botId,
      });
      if (!allowance) throw new SharedMicoUnavailableError();
      return reserveModelCredits(
        prisma,
        membership.organizationId,
        maxCostUsd,
        {
          ...attribution,
          // A member's holds count against their allowance through their run.
          runId: call.runId ?? requester.runId,
          requestedByUserId: requester.userId,
        },
        undefined,
        allowance,
      );
    },
    afterCall: (reservationId, usage) => recordModelCreditReceipt(prisma, reservationId, usage),
    onRequestId: async (id, providerRequestId) => {
      await prisma.modelCreditEntry.updateMany({
        where: { id, providerRequestId: null },
        data: { providerRequestId },
      });
    },
  };
}
