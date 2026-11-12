import { TRANSCRIPTION_MODEL, MAX_TRANSCRIPTION_TOKENS } from "../contracts/transcription.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import type { MeshDatabase } from "../storage/database.js";
import type { EconomicLedger, EconomicSettlementInput } from "./economic-ledger.js";
import { PromotionalCredits } from "./promotional-credits.js";

/** Apply with the existing migration owner before enabling contribution funding. */
export const contributionCreditSchemaSql = `
      CREATE TABLE IF NOT EXISTS economic_promotional_grants (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, issued_by TEXT NOT NULL,
        reason TEXT NOT NULL, amount_microunits BIGINT NOT NULL CHECK(amount_microunits > 0),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS economic_promotional_grants_account ON economic_promotional_grants(account_id);

      CREATE TABLE IF NOT EXISTS economic_credit_transfers (
        id TEXT PRIMARY KEY, settlement_id TEXT NOT NULL REFERENCES economic_settlements(id),
        node_id TEXT NOT NULL, account_id TEXT NOT NULL, ownership_generation BIGINT NOT NULL,
        amount_microunits BIGINT NOT NULL CHECK(amount_microunits > 0), created_at BIGINT NOT NULL,
        UNIQUE(settlement_id, node_id)
      );
      CREATE TABLE IF NOT EXISTS economic_credit_holds (
        id TEXT PRIMARY KEY REFERENCES api_usage(id), account_id TEXT NOT NULL,
        request_digest TEXT NOT NULL, idempotency_digest TEXT,
        amount_microunits BIGINT NOT NULL CHECK(amount_microunits > 0),
        job_id TEXT UNIQUE, status TEXT NOT NULL CHECK(status IN ('reserved','settled','released')),
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS economic_credit_holds_account ON economic_credit_holds(account_id,status);
      CREATE UNIQUE INDEX IF NOT EXISTS economic_credit_holds_idempotency
        ON economic_credit_holds(account_id,idempotency_digest);
      CREATE INDEX IF NOT EXISTS economic_credit_transfers_account ON economic_credit_transfers(account_id);
      CREATE TABLE IF NOT EXISTS economic_credit_replays (
        usage_id TEXT PRIMARY KEY REFERENCES economic_credit_holds(id),
        hold_id TEXT NOT NULL REFERENCES economic_credit_holds(id)
      );
      CREATE TABLE IF NOT EXISTS api_contribution_funded_usage (
        usage_id TEXT PRIMARY KEY REFERENCES api_usage(id) ON DELETE CASCADE
      );
    `;

/** Server-owned adjustments: transfers conserve the ledger's total supply. */
export class ContributionCreditWallet {
  private promotions: PromotionalCredits | null;
  private managedPurchases = false;
  private purchasedCredits = false;
  constructor(private readonly database: MeshDatabase, private readonly ledger: EconomicLedger, expiringPromotions = false) {
    this.promotions = expiringPromotions ? new PromotionalCredits(database) : null;
  }

  async initialize(): Promise<void> {
    if ((this.database.raw as unknown as { dialect?: string }).dialect !== "postgres")
      throw new Error("contribution_wallet_requires_async_postgres");
    // Schema is applied separately by the migration owner. Runtime must not need DDL.
    for (const table of ["economic_credit_transfers", "economic_credit_holds",
      "economic_credit_replays", "api_contribution_funded_usage", "economic_promotional_grants"])
      await this.database.raw.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
    // Disabling new referrals must never revive previously expired awards.
    // Once migrated, expiry remains authoritative independently of the campaign flag.
    const expirySchema = await this.database.raw.prepare(`SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='economic_promotional_grants' AND column_name='expires_at'`).get();
    if (expirySchema && !this.promotions) this.promotions = new PromotionalCredits(this.database);
    if (this.promotions) await this.promotions.totals();
    this.purchasedCredits = Boolean(await this.database.raw.prepare(`SELECT 1 FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name='economic_wallet_topups'`).get());
    // Accounting stays authoritative even when new managed purchases are disabled.
    this.managedPurchases = Boolean(await this.database.raw.prepare(`SELECT 1 FROM information_schema.tables
      WHERE table_schema=current_schema() AND table_name='economic_managed_purchases'`).get());
    await this.database.raw.prepare(`UPDATE economic_credit_holds SET status='released'
      WHERE status='reserved' AND id IN (SELECT id FROM api_usage WHERE status='failed')
      ${this.managedPurchases ? "AND NOT EXISTS (SELECT 1 FROM economic_managed_purchases p WHERE p.usage_id=economic_credit_holds.id)" : ""}`).run();
  }

  async reserved(accountId: string): Promise<number> {
    const row = await this.database.raw.prepare(`SELECT COALESCE(SUM(amount_microunits),0) AS total
      FROM economic_credit_holds WHERE account_id=? AND status='reserved'`).get(accountId) as { total: number };
    return Number(row.total);
  }

  async recoverUsage(accountId: string, api: {
    failUsage(id: string, code: string): unknown;
    completeUsage(id: string, input: number, output: number): unknown;
  }): Promise<void> {
    await this.database.transaction(async () => {
      const pending = await this.database.raw.prepare(`SELECT u.id,h.status,j.status AS job_status,
        s.input_tokens,s.output_tokens FROM api_usage u
        JOIN api_contribution_funded_usage f ON f.usage_id=u.id
        LEFT JOIN economic_credit_replays r ON r.usage_id=u.id
        JOIN economic_credit_holds h ON h.id=COALESCE(r.hold_id,u.id)
        LEFT JOIN jobs j ON j.id=h.job_id
        LEFT JOIN economic_settlements s ON s.job_id=h.job_id AND s.payer_account_id=u.user_id
        WHERE u.user_id=? AND u.status='pending' AND j.status IN ('failed','completed')`).all(accountId);
      for (const row of pending) {
        if (row.status === "settled" && row.input_tokens !== null && row.output_tokens !== null)
          await api.completeUsage(String(row.id), Number(row.input_tokens), Number(row.output_tokens));
        else {
          await api.failUsage(String(row.id), "contribution_execution_interrupted");
          await this.release(String(row.id));
        }
      }
    });
  }

  async summary(kind: "account" | "node" | "platform", ownerId: string, now = Date.now()) {
    const summary = await this.ledger.summary(kind, ownerId);
    const row = kind === "platform" ? { total: 0 } : await this.database.raw.prepare(`
      SELECT COALESCE(SUM(amount_microunits),0) AS total FROM economic_credit_transfers
      WHERE ${kind === "account" ? "account_id" : "node_id"}=?`).get(ownerId) as { total: number };
    const adjustment = Number(row.total) * (kind === "node" ? -1 : 1);
    const promotion = kind === "node" ? { total: 0 } : await this.database.raw.prepare(`
      SELECT COALESCE(SUM(amount_microunits),0) AS total FROM economic_promotional_grants
      ${kind === "account" ? "WHERE account_id=?" : ""}`).get(...(kind === "account" ? [ownerId] : [])) as { total: number };
    const promotionalGrantedMicrounits = Number(promotion.total);
    const expiring = this.promotions && kind !== "node" ? await this.promotions.totals(kind === "account" ? ownerId : undefined, now) : null;
    const external = this.managedPurchases && kind !== "node" ? await this.database.raw.prepare(`
      SELECT COALESCE(SUM(${kind === "account" ? "total_microunits" : "fee_microunits"}),0) AS total
      FROM economic_managed_purchases WHERE state='settled' ${kind === "account" ? "AND account_id=?" : ""}`)
      .get(...(kind === "account" ? [ownerId] : [])) : null;
    const managedAdjustment = Number(external?.total ?? 0) * (kind === "account" ? -1 : 1);
    const cash = this.purchasedCredits && kind !== "node" ? await this.database.raw.prepare(`SELECT
      COALESCE(SUM(amount_microunits-refunded_microunits),0) AS total FROM economic_wallet_topups
      WHERE credited=true ${kind === "account" ? "AND account_id=?" : ""}`).get(...(kind === "account" ? [ownerId] : [])) : null;
    const purchased = Number(cash?.total ?? 0) * (kind === "platform" ? -1 : 1);
    const balanceMicrounits = summary.balanceMicrounits + adjustment + managedAdjustment + purchased
      + (promotionalGrantedMicrounits - (expiring?.expired ?? 0)) * (kind === "platform" ? -1 : 1);
    const reservedMicrounits = kind === "account" ? await this.reserved(ownerId) : 0;
    return { ...summary, balanceMicrounits, reservedMicrounits,
      availableMicrounits: Math.max(0, balanceMicrounits - reservedMicrounits),
      promotionalGrantedMicrounits, contributionEarnedMicrounits: kind === "account" ? adjustment : 0,
      ...(expiring && kind === "account" ? { promotionalExpiredMicrounits: expiring.expired,
        nextPromotionalExpiry: expiring.nextExpiry } : {}),
      lifetimeMicrounits: summary.lifetimeMicrounits + (kind === "account" ? adjustment : 0) };
  }

  async reserve(id: string, accountId: string, request: { model: string; messages: unknown[]; max_tokens?: number | undefined }, idempotencyKey?: string | null): Promise<void> {
    const now = Date.now();
    const policies = (await Promise.all((["remote-replica", "distributed-pipeline"] as const)
      .map(route => this.ledger.resolvePricingPolicy(request.model, route, now)))).filter(policy => policy !== null);
    if (!policies.length) throw new Error("contribution_pricing_unavailable");
    const inputBound = request.model === TRANSCRIPTION_MODEL ? MAX_TRANSCRIPTION_TOKENS : Buffer.byteLength(JSON.stringify(request.messages), "utf8") + request.messages.length * 64;
    const maxima = policies.map(policy => BigInt(inputBound) * BigInt(policy.inputMicrounitsPerToken)
      + BigInt(request.max_tokens ?? 256) * BigInt(policy.outputMicrounitsPerToken));
    const maximum = Number(maxima.reduce((a, b) => a > b ? a : b));
    if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error("contribution_quote_invalid");
    const digest = sha256CanonicalEvidence(request);
    const idempotency = idempotencyKey ? sha256CanonicalEvidence({ accountId, idempotencyKey }) : null;
    // The PostgreSQL driver serializes writers across instances; SQLite uses BEGIN IMMEDIATE.
    await this.database.transaction(async () => {
      const admittedAt = Date.now();
      const previous = await this.database.raw.prepare("SELECT * FROM economic_credit_holds WHERE id=?").get(id);
      if (previous) {
        if (previous.account_id !== accountId || previous.request_digest !== digest
          || Number(previous.amount_microunits) !== maximum || previous.status !== "reserved")
          throw new Error("contribution_hold_conflict");
        return;
      }
      const replay = idempotency ? await this.database.raw.prepare(`SELECT * FROM economic_credit_holds
        WHERE account_id=? AND idempotency_digest=?`).get(accountId, idempotency) : undefined;
      if (replay) {
        if (replay.request_digest !== digest || (replay.status !== "reserved" && replay.status !== "settled"))
          throw new Error("contribution_hold_conflict");
        await this.database.raw.prepare(`INSERT INTO economic_credit_holds
          (id,account_id,request_digest,amount_microunits,status,created_at) VALUES (?,?,?,?,'released',?)`)
          .run(id, accountId, digest, maximum, now);
        await this.database.raw.prepare("INSERT INTO economic_credit_replays(usage_id,hold_id) VALUES (?,?)")
          .run(id, String(replay.id));
        return;
      }
      const summary = await this.summary("account", accountId, admittedAt);
      if (summary.availableMicrounits < maximum) throw new Error("insufficient_contribution_credits");
      await this.database.raw.prepare(`INSERT INTO economic_credit_holds
        (id,account_id,request_digest,idempotency_digest,amount_microunits,status,created_at) VALUES (?,?,?,?,?,'reserved',?)`)
        .run(id, accountId, digest, idempotency, maximum, now);
      await this.promotions?.reserve(id, accountId, maximum, admittedAt);
    });
  }

  async attach(id: string, jobId: string): Promise<void> {
    await this.database.transaction(async () => {
      const replay = await this.database.raw.prepare("SELECT hold_id FROM economic_credit_replays WHERE usage_id=?").get(id);
      if (replay) id = String(replay.hold_id);
      const hold = await this.database.raw.prepare("SELECT * FROM economic_credit_holds WHERE id=?").get(id);
      const existing = await this.database.raw.prepare("SELECT * FROM economic_credit_holds WHERE job_id=?").get(jobId);
      if (hold?.status === "settled" && hold.job_id === jobId) return;
      if (existing && existing.id !== id) {
        if (!hold || existing.account_id !== hold.account_id || existing.request_digest !== hold.request_digest
          || (existing.status !== "reserved" && existing.status !== "settled"))
          throw new Error("contribution_hold_binding_failed");
        await this.release(id);
        await this.database.raw.prepare(`INSERT INTO economic_credit_replays(usage_id,hold_id)
          VALUES (?,?) ON CONFLICT(usage_id) DO NOTHING`).run(id, String(existing.id));
        return;
      }
      const result = await this.database.raw.prepare(`UPDATE economic_credit_holds SET job_id=?
        WHERE id=? AND status='reserved' AND (job_id IS NULL OR job_id=?)`).run(jobId, id, jobId);
      if (Number(result.changes) !== 1) throw new Error("contribution_hold_binding_failed");
    });
  }

  async release(id: string): Promise<void> {
    await this.database.raw.prepare("UPDATE economic_credit_holds SET status='released' WHERE id=? AND status='reserved'").run(id);
  }

  async assertSettled(id: string): Promise<void> {
    const replay = await this.database.raw.prepare("SELECT hold_id FROM economic_credit_replays WHERE usage_id=?").get(id);
    const hold = await this.database.raw.prepare("SELECT status FROM economic_credit_holds WHERE id=?")
      .get(replay ? String(replay.hold_id) : id);
    if (hold?.status !== "settled") throw new Error("contribution_settlement_missing");
  }

  async settle(input: EconomicSettlementInput) {
    return await this.database.transaction(async () => {
      const hold = await this.database.raw.prepare("SELECT * FROM economic_credit_holds WHERE job_id=?").get(input.jobId);
      const result = await this.ledger.settle(input);
      if (hold) {
        if (hold.account_id !== result.payerAccountId || result.grossMicrounits > Number(hold.amount_microunits)
          || (hold.status !== "reserved" && hold.status !== "settled"))
          throw new Error("contribution_settlement_invalid");
        if (hold.status === "reserved") {
          await this.promotions?.settle(String(hold.id), result.grossMicrounits);
          await this.database.raw.prepare("UPDATE economic_credit_holds SET status='settled' WHERE id=?").run(String(hold.id));
          const balanceAfterDebit = (await this.summary("account", result.payerAccountId)).balanceMicrounits;
          const otherReservations = await this.reserved(result.payerAccountId);
          if (balanceAfterDebit < otherReservations) throw new Error("contribution_balance_changed");
        }
        await this.database.raw.prepare("UPDATE economic_credit_holds SET status='settled' WHERE id=?").run(String(hold.id));
      }
      const evidenceRow = await this.database.raw.prepare("SELECT evidence_json FROM economic_contribution_evidence WHERE id=?")
        .get(result.contributionEvidenceId) as { evidence_json: string };
      // ledger.settle has validated and bound this physical evidence and its contributors.
      const evidence = JSON.parse(evidenceRow.evidence_json) as { observedFrom: number };
      for (const credit of result.contributorCredits) {
        if (credit.amountMicrounits <= 0) continue;
        const owner = await this.database.getNodeOwnership("device", credit.nodeId);
        if (!owner || owner.status !== "active" || owner.updatedAt > evidence.observedFrom) continue;
        const transfer = { settlementId: result.id, nodeId: credit.nodeId, accountId: owner.accountId,
          generation: owner.generation, amountMicrounits: credit.amountMicrounits };
        await this.database.raw.prepare(`INSERT INTO economic_credit_transfers
          (id,settlement_id,node_id,account_id,ownership_generation,amount_microunits,created_at)
          VALUES (?,?,?,?,?,?,?) ON CONFLICT(settlement_id,node_id) DO NOTHING`)
          .run(sha256CanonicalEvidence(transfer), result.id, credit.nodeId, owner.accountId,
            owner.generation, credit.amountMicrounits, input.createdAt);
      }
      return result;
    });
  }
}
