import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { MeshDatabase } from "../src/storage/database.js";

const receipt = (character: string) => `sha256:${character.repeat(64)}`;

async function fixture() {
  const database = (await MeshDatabase.open(":memory:"));
  const ledger = new EconomicLedger(database, {
    receiptSigning: { keyId: "test-economic-key", privateKey: generateKeyPairSync("ed25519").privateKey },
  });
  const policy = (await ledger.registerPricingPolicy({
    modelId: "qwen3-0.6b",
    routeClass: "distributed-pipeline",
    version: 1,
    inputMicrounitsPerToken: 2,
    outputMicrounitsPerToken: 6,
    platformFeeBps: 2_000,
    effectiveAt: 1_000,
    retiredAt: null,
  }));
  return { database, ledger, policy };
}

async function seedEvidence(database: MeshDatabase, jobId: string, executionReceiptId: string, nodes: string[]) {
  const id = receipt(jobId.length.toString(16).slice(-1));
  const evidence = {
    schema: "mycellios-physical-contribution-evidence/1", id, jobId, executionReceiptId,
    traceDigest: receipt(jobId.length.toString(16).slice(-1)),
    participants: nodes.sort().map((nodeId, index) => ({
      nodeId, workerId: `worker-${index}`, physicalIdentityDigest: receipt(String(index + 1)),
      canaryEvidenceIds: [receipt(String(index + 3))], stageCount: 1,
    })),
    physicalBoundaryCount: Math.max(0, nodes.length - 1), observedFrom: 1_000, observedUntil: 1_900, createdAt: 2_000,
  };
  (await database.raw.prepare("INSERT INTO economic_contribution_evidence(id, job_id, execution_receipt_id, trace_digest, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, jobId, executionReceiptId, evidence.traceDigest, JSON.stringify(evidence), 2_000));
  return id;
}

describe("economic ledger", () => {
  it("settles usage and work as a balanced deterministic double entry", async () => {
    const { database, ledger, policy } = (await fixture());
    const contributionEvidenceId = (await seedEvidence(database, "job-1", receipt("a"), ["node-a", "node-b"]));
    const settlement = (await ledger.settle({
      jobId: "job-1", executionReceiptId: receipt("a"), pricingPolicyId: policy.id,
      contributionEvidenceId,
      payerAccountId: "customer-1", inputTokens: 100, outputTokens: 50,
      contributors: [{ nodeId: "node-b", weight: 3 }, { nodeId: "node-a", weight: 1 }],
      createdAt: 2_000,
    }));
    expect(settlement).toMatchObject({ grossMicrounits: 500, providerMicrounits: 400, platformMicrounits: 100 });
    expect(settlement.contributorCredits).toEqual([
      { nodeId: "node-a", amountMicrounits: 100 },
      { nodeId: "node-b", amountMicrounits: 300 },
    ]);
    expect((await ledger.balance("account", "customer-1"))).toBe(-500);
    expect((await ledger.balance("node", "node-a"))).toBe(100);
    expect((await ledger.balance("node", "node-b"))).toBe(300);
    expect((await ledger.balance("platform", "mycellios"))).toBe(100);
    expect((await ledger.nodeReputation("node-a"))).toMatchObject({ verifiedJobs: 1, earnedMicrounits: 100 });
    const total = (await database.raw.prepare("SELECT SUM(amount_microunits) AS total FROM economic_ledger_entries WHERE settlement_id = ?")
      .get(settlement.id)) as { total: number };
    expect(total.total).toBe(0);
  });

  it("replays an identical job idempotently and rejects changed job or receipt reuse", async () => {
    const { database, ledger, policy } = (await fixture());
    const contributionEvidenceId = (await seedEvidence(database, "job-2", receipt("b"), ["node-a"]));
    const input = {
      jobId: "job-2", executionReceiptId: receipt("b"), pricingPolicyId: policy.id,
      contributionEvidenceId,
      payerAccountId: "customer-2", inputTokens: 10, outputTokens: 5,
      contributors: [{ nodeId: "node-a", weight: 1 }], createdAt: 2_000,
    };
    expect((await ledger.settle(input))).toEqual((await ledger.settle(input)));
    await expect((async () => (await ledger.settle({ ...input, outputTokens: 6 })))()).rejects.toThrow("economic_settlement_job_conflict");
    await expect((async () => (await ledger.settle({ ...input, jobId: "job-3" })))()).rejects.toThrow("economic_settlement_receipt_replay");
    const count = (await database.raw.prepare("SELECT COUNT(*) AS count FROM economic_settlements").get()) as { count: number };
    expect(count.count).toBe(1);
  });

  it("rejects inactive pricing, duplicate contributors and unsafe arithmetic without partial writes", async () => {
    const { database, ledger, policy } = (await fixture());
    const contributionEvidenceId = (await seedEvidence(database, "job-4", receipt("c"), ["node-a"]));
    const base = {
      jobId: "job-4", executionReceiptId: receipt("c"), pricingPolicyId: policy.id,
      contributionEvidenceId,
      payerAccountId: "customer-3", inputTokens: 1, outputTokens: 1,
      contributors: [{ nodeId: "node-a", weight: 1 }], createdAt: 500,
    };
    await expect((async () => (await ledger.settle(base)))()).rejects.toThrow("economic_pricing_policy_is_not_effective");
    await expect((async () => (await ledger.settle({ ...base, createdAt: 2_000, contributors: [{ nodeId: "node-a", weight: 1 }, { nodeId: "node-a", weight: 1 }] })))()).rejects.toThrow("economic_contributor_is_duplicated");
    const unsafeEvidenceId = (await seedEvidence(database, "job-unsafe", receipt("d"), ["node-a"]));
    await expect((async () => (await ledger.settle({ ...base, jobId: "job-unsafe", executionReceiptId: receipt("d"), contributionEvidenceId: unsafeEvidenceId, createdAt: 2_000, inputTokens: Number.MAX_SAFE_INTEGER })))()).rejects.toThrow("economic_settlement_amount_is_unsafe");
    const count = (await database.raw.prepare("SELECT COUNT(*) AS count FROM economic_settlements").get()) as { count: number };
    expect(count.count).toBe(0);
  });

  it("fails closed without matching durable physical contribution evidence", async () => {
    const { database, ledger, policy } = (await fixture());
    const base = {
      jobId: "job-evidence", executionReceiptId: receipt("e"), contributionEvidenceId: receipt("9"),
      pricingPolicyId: policy.id, payerAccountId: "customer-evidence", inputTokens: 1, outputTokens: 1,
      contributors: [{ nodeId: "node-a", weight: 1 }], createdAt: 2_000,
    };
    await expect((async () => (await ledger.settle(base)))()).rejects.toThrow("economic_contribution_evidence_not_found");
    const evidenceId = (await seedEvidence(database, "job-evidence", receipt("e"), ["node-a"]));
    await expect((async () => (await ledger.settle({
      ...base, contributionEvidenceId: evidenceId,
      contributors: [{ nodeId: "node-b", weight: 1 }],
    })))()).rejects.toThrow("economic_contributors_do_not_match_physical_evidence");
    expect((await ledger.nodeReputation("node-a"))).toMatchObject({ verifiedJobs: 0, lastEvidenceId: null });
  });

  it("uses model-specific pricing ahead of the internal wildcard fallback", async () => {
    const database = (await MeshDatabase.open(":memory:"));
    const ledger = new EconomicLedger(database, {
      receiptSigning: { keyId: "test-economic-key", privateKey: generateKeyPairSync("ed25519").privateKey },
    });
    const defaults = (await ledger.registerDefaultInternalPricing());
    expect((await ledger.resolvePricingPolicy("unconfigured-model", "remote-replica", 1))?.id).toBe(defaults[0]!.id);
    const exact = (await ledger.registerPricingPolicy({
      modelId: "qwen3-special", routeClass: "remote-replica", version: 1,
      inputMicrounitsPerToken: 2, outputMicrounitsPerToken: 8,
      platformFeeBps: 1_000, effectiveAt: 0, retiredAt: null,
    }));
    expect((await ledger.resolvePricingPolicy("qwen3-special", "remote-replica", 1))?.id).toBe(exact.id);
  });
});
