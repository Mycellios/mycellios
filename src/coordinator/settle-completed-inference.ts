import type { FastifyBaseLogger } from "fastify";
import type { JobStreamEvent } from "./mesh-service.js";
import type { EconomicLedger } from "../economy/economic-ledger.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { PhysicalContributionEvidenceAuthority } from "../economy/physical-contribution-evidence.js";
import type { MeshStore } from "../storage/store.js";
import type { WorkerHub } from "./worker-hub.js";

export function createInferenceSettlement(context: {
  economicLedger: EconomicLedger;
  creditWallet: ContributionCreditWallet | null;
  physicalContributionEvidence: PhysicalContributionEvidenceAuthority;
  store: Pick<MeshStore, "listWorkers">;
  hub: Pick<WorkerHub, "currentWorkerSessionId">;
  logger: Pick<FastifyBaseLogger, "error">;
}) {
  const { economicLedger, creditWallet, physicalContributionEvidence, store, hub, logger } = context;
  return async (input: {
    userId: string;
    jobId: string;
    modelId: string;
    routeClass: "replica" | "pipeline";
    inputTokens: number;
    outputTokens: number;
    networkTrace: NonNullable<Extract<JobStreamEvent, { type: "completed" }>["result"]["networkTrace"]>;
    recovery: NonNullable<Extract<JobStreamEvent, { type: "completed" }>["result"]["recovery"]>;
    executionReceiptId: string;
  }): Promise<void> => {
    const pricingRoute = input.routeClass === "pipeline"
      ? "distributed-pipeline" as const
      : "remote-replica" as const;
    const createdAt = Date.now();
    const policy = (await economicLedger.resolvePricingPolicy(input.modelId, pricingRoute, createdAt));
    if (!policy) return;
    const weights = new Map<string, number>();
    for (const stage of input.networkTrace.stages) {
      const nodeId = stage.nodeId ?? stage.workerId;
      if (nodeId) weights.set(nodeId, (weights.get(nodeId) ?? 0) + 1);
    }
    if (weights.size === 0) {
      logger.error({ jobId: input.jobId }, "Economic settlement lacks an attributable execution node");
      return;
    }
    const executionReceiptId = input.executionReceiptId;
    try {
      const contributionEvidence = (await physicalContributionEvidence.certify({
        currentSessionIdForWorker: workerId => hub.currentWorkerSessionId(workerId),
        jobId: input.jobId,
        executionReceiptId,
        trace: input.networkTrace,
        workers: (await store.listWorkers()),
        createdAt,
      }));
      (await (creditWallet ?? economicLedger).settle({
        jobId: input.jobId,
        executionReceiptId,
        contributionEvidenceId: contributionEvidence.id,
        pricingPolicyId: policy.id,
        executionRecovery: input.recovery,
        payerAccountId: input.userId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        contributors: [...weights].map(([nodeId, weight]) => ({ nodeId, weight })),
        createdAt,
      }));
    } catch (error) {
      logger.error({
        jobId: input.jobId,
        error: error instanceof Error ? error.message : String(error),
      }, "Economic settlement rejected because physical contribution was not verified");
    }
  };
}

type Completed = Extract<JobStreamEvent, { type: "completed" }>;

/**
 * A split memory embedding request has no single route, so each validated
 * piece gets its own signed receipt; an ordinary completion gets one.
 */
export async function withPieceReceipts(event: Completed, attach: (event: Completed) => Promise<Completed>): Promise<Completed> {
  if (!event.pieces) return await attach(event);
  const pieces: Completed["result"][] = [];
  for (const piece of event.pieces) pieces.push((await attach({ type: "completed", result: piece })).result);
  return { ...event, pieces };
}

/** The executions to settle: each piece of a split request, or the completion itself. */
export function completedParts(event: Completed): Completed["result"][] {
  return event.pieces ?? [event.result];
}

/** Names each piece's request, tokens and receipt in the response and the stored message. */
export function pieceSummary(event: Completed): { pieces?: Array<{ request_id: string; input_tokens: number; execution_receipt_id: string | null }> } {
  return event.pieces ? { pieces: event.pieces.map((piece) => ({ request_id: piece.jobId, input_tokens: piece.metrics.inputTokens,
    execution_receipt_id: piece.executionReceiptId ?? null })) } : {};
}
