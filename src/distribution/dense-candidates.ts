import { createHash } from "node:crypto";
import { denseStagePolicySchema, type DenseStagePolicy } from "../contracts/dense-stage.js";
import { denseStageMemoryAdmission } from "./dense-stage-memory.js";
import { budgetDenseStage, validateDenseBudgetGeometry, type DenseBudgetGeometry } from "./dense-stage-budget.js";
import { evaluateDistributionPlan, stageMemoryBytes } from "./cost-model.js";
import type { DistributionPlan, DistributionTopology, DistributedModelProfile,
  DistributionWorkload, StagePlacement } from "./types.js";

/** Policies must already be qualified for the offer's actual runtime/backend. */
export interface DenseCandidateOffer {
  nodeId: string;
  connected: boolean;
  observedAt: number;
  policies: readonly DenseStagePolicy[];
  /** Explicit opt-in to stage-specific budgets within these qualified offer ceilings. */
  adaptiveBudget?: DenseBudgetGeometry;
}

/** Enumerate executable calibration candidates, never claim their estimated ranking is measured. */
export function enumerateDenseCandidates(input: {
  model: DistributedModelProfile; topology: DistributionTopology; workload: DistributionWorkload;
  offers: readonly DenseCandidateOffer[]; rootNodeId: string; now: number;
  minimumStages?: number; maximumEvaluations?: number;
}): { candidates: { id: string; plan: DistributionPlan }[]; examined: number; exhaustive: boolean } {
  const limit = input.maximumEvaluations ?? 10_000, minimum = input.minimumStages ?? 1;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000
      || !Number.isSafeInteger(minimum) || minimum < 1 || minimum > input.workload.maxStages
      || !Number.isFinite(input.now) || input.model.layers.length < 1) {
    throw new Error("dense_candidate_search_invalid");
  }
  const nodes = new Map(input.topology.nodes.map(node => [node.id, node]));
  if (nodes.size !== input.topology.nodes.length
      || new Set(input.offers.map(offer => offer.nodeId)).size !== input.offers.length) {
    throw new Error("dense_candidate_duplicate_node");
  }
  const offers = input.offers.filter(offer => {
    if (!nodes.has(offer.nodeId)) throw new Error("dense_candidate_unknown_node");
    offer.policies.forEach(policy => denseStagePolicySchema.parse(policy));
    if (offer.adaptiveBudget) validateDenseBudgetGeometry(offer.adaptiveBudget);
    const age = input.now - offer.observedAt;
    return offer.connected && Number.isFinite(age) && age >= 0 && age <= 120;
  }).sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const candidates = new Map<string, DistributionPlan>();
  let examined = 0, exhaustive = true;
  const count = input.model.layers.length;
  function extend(stages: StagePlacement[], start: number): void {
    if (!exhaustive || stages.length >= input.workload.maxStages) return;
    for (const offer of offers) {
      if (!exhaustive) return;
      if ((stages.length === 0 && offer.nodeId !== input.rootNodeId)
          || stages.some(stage => stage.nodeId === offer.nodeId)) continue;
      const node = nodes.get(offer.nodeId)!;
      for (let end = start + 1; end <= count; end++) {
        const first = stages.length === 0, last = end === count;
        if (node.maxStageLayers !== undefined && end - start > node.maxStageLayers) break;
        if (node.stageRoles && ((first && !node.stageRoles.includes("head"))
            || (last && !node.stageRoles.includes("tail"))
            || (!first && !last && !node.stageRoles.includes("middle")))) continue;
        for (const policy of offer.policies) {
          if (examined === limit) { exhaustive = false; return; }
          examined++;
          // Host lookup is an endpoint capability, never a middle-stage fallback.
          if (policy.hostTokenLookup && (!first || input.model.tiedEmbeddingAndHead)) continue;
          const stage: StagePlacement = { nodeId: offer.nodeId, layerStart: start, layerEnd: end };
          const sized = offer.adaptiveBudget ? budgetDenseStage({ model: input.model,
            stage, node, workload: input.workload, first, last, policy, geometry: offer.adaptiveBudget }) : policy;
          if (!sized) continue;
          stage.dense = structuredClone(sized);
          const memory = stageMemoryBytes(input.model, stage, input.workload, first, last);
          if (denseStageMemoryAdmission(input.model, stage, node, input.workload,
              memory, first, last)?.error) continue;
          const next = [...stages, stage];
          if (!last) { extend(next, end); continue; }
          if (next.length < minimum) continue;
          const plan: DistributionPlan = { algorithm: "dense-calibration-candidates-v1", codec: "fp16",
            microBatchSize: 1, prefillChunkTokens: Math.max(1, input.workload.promptTokens), stages: next };
          if (!evaluateDistributionPlan(input.model, input.topology, input.workload, plan).feasible) continue;
          const id = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
          candidates.set(id, plan);
        }
      }
    }
  }
  extend([], 0);
  return { candidates: [...candidates].map(([id, plan]) => ({ id, plan })), examined, exhaustive };
}
