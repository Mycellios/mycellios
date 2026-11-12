import type { MeshDatabase } from "../storage/database.js";
import type { ContributionCreditWallet } from "./contribution-credit-wallet.js";
import { PromotionalCredits } from "./promotional-credits.js";
import { managedCharge, usdAtoms } from "./managed-pricing.js";
import { sha256CanonicalEvidence } from "../core/json.js";

/** Apply separately as migration owner. No runtime DDL and no native inference evidence. */
export const managedPurchasesSchemaSql = `
CREATE TABLE IF NOT EXISTS economic_managed_purchases (
  usage_id TEXT PRIMARY KEY REFERENCES economic_credit_holds(id),
  account_id TEXT NOT NULL, key_digest TEXT NOT NULL, request_digest TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, maximum_usd TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','submitted','uncertain','settled','released')),
  provider_receipt_id TEXT, upstream_usd TEXT, upstream_microunits BIGINT,
  fee_microunits BIGINT, total_microunits BIGINT,
  receipt_digest TEXT, response_json TEXT, pending_receipt_json TEXT, remote_job_json TEXT, created_at BIGINT NOT NULL,
  UNIQUE(account_id,key_digest),
  CHECK(state <> 'settled' OR (provider_receipt_id IS NOT NULL AND receipt_digest IS NOT NULL
    AND upstream_microunits >= 0 AND fee_microunits >= 0
    AND total_microunits = upstream_microunits + fee_microunits))
);
CREATE UNIQUE INDEX IF NOT EXISTS economic_managed_receipt_identity
  ON economic_managed_purchases(provider,provider_receipt_id) WHERE provider_receipt_id IS NOT NULL;
REVOKE ALL ON economic_managed_purchases FROM PUBLIC;
ALTER TABLE economic_managed_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS remote_job_json TEXT;
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS poll_until BIGINT NOT NULL DEFAULT 0;
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS settled_at BIGINT;
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS safety_stop BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS economic_managed_safety_stop ON economic_managed_purchases(provider) WHERE safety_stop=true;
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS funding_cost_basis_points BIGINT NOT NULL DEFAULT 0 CHECK(funding_cost_basis_points BETWEEN 0 AND 100000);
ALTER TABLE economic_managed_purchases ADD COLUMN IF NOT EXISTS funding_cost_microunits BIGINT NOT NULL DEFAULT 0 CHECK(funding_cost_microunits >= 0);
ALTER TABLE economic_managed_purchases DROP CONSTRAINT IF EXISTS economic_managed_purchases_check;
ALTER TABLE economic_managed_purchases DROP CONSTRAINT IF EXISTS managed_purchase_total;
ALTER TABLE economic_managed_purchases ADD CONSTRAINT managed_purchase_total CHECK(state <> 'settled' OR
 (provider_receipt_id IS NOT NULL AND receipt_digest IS NOT NULL AND upstream_microunits IS NOT NULL AND upstream_microunits >= 0
  AND fee_microunits IS NOT NULL AND fee_microunits >= 0 AND total_microunits IS NOT NULL
  AND total_microunits = upstream_microunits + funding_cost_microunits + fee_microunits));
ALTER TABLE economic_credit_holds DROP CONSTRAINT IF EXISTS economic_credit_holds_amount_microunits_check;
ALTER TABLE economic_credit_holds ADD CONSTRAINT economic_credit_holds_amount_microunits_check CHECK(amount_microunits >= 0);
`;

/** The migration owner names the coordinator's existing native DB role; no browser grants. */
export function managedPurchasesAccessSchemaSql(runtimeRole: string): string {
  if (!/^[a-z_][a-z_0-9]{0,62}$/.test(runtimeRole)) throw new Error("managed_runtime_role_invalid");
  return `DO $access$ DECLARE role_name text; BEGIN
    FOR role_name IN SELECT rolname FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
      EXECUTE format('REVOKE ALL ON economic_managed_purchases FROM %I',role_name);
    END LOOP;
  END;$access$;
  DROP POLICY IF EXISTS managed_native_access ON economic_managed_purchases;
  CREATE POLICY managed_native_access ON economic_managed_purchases TO "${runtimeRole}" USING (true) WITH CHECK (true);
  GRANT SELECT,INSERT,UPDATE ON economic_managed_purchases TO "${runtimeRole}";`;
}

/** One budget shared with native inference, but external purchases have distinct accounting. */
export class ManagedPurchases {
  private promotions: PromotionalCredits | null = null;
  constructor(private readonly db: MeshDatabase, private readonly wallet: ContributionCreditWallet,
    private readonly dailyLimitMicrounits: number, private readonly totalLimitMicrounits?: number) {
    if (!Number.isSafeInteger(dailyLimitMicrounits) || dailyLimitMicrounits < 1) throw new Error("managed_budget_invalid");
    if (totalLimitMicrounits !== undefined && (!Number.isSafeInteger(totalLimitMicrounits) || totalLimitMicrounits < 1)) throw new Error("managed_budget_invalid");
  }
  async initialize() {
    if (this.db.raw.dialect !== "postgres") throw new Error("managed_purchases_require_postgres");
    await this.db.raw.prepare("SELECT 1 FROM economic_managed_purchases LIMIT 0").all();
    await this.db.raw.prepare("SELECT funding_cost_basis_points,funding_cost_microunits,poll_until,settled_at,safety_stop FROM economic_managed_purchases LIMIT 0").all();
    const protection = await this.db.raw.prepare(`SELECT CASE WHEN c.relrowsecurity THEN 1 ELSE 0 END AS protected FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname='economic_managed_purchases'`).get();
    if (protection?.protected !== 1) throw new Error("managed_private_storage_required");
    const expiry = await this.db.raw.prepare(`SELECT 1 FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='economic_promotional_grants' AND column_name='expires_at'`).get();
    this.promotions = expiry ? new PromotionalCredits(this.db) : null;
  }
  async find(accountId: string, key: string) {
    return await this.db.raw.prepare("SELECT * FROM economic_managed_purchases WHERE account_id=? AND key_digest=?")
      .get(accountId, sha256CanonicalEvidence({ accountId, key }));
  }
  async reserve(input: { usageId: string; accountId: string; key: string; digest: string;
    provider: string; model: string; maximumUsd: string; fundingCostBasisPoints?: number }) {
    const funding = input.fundingCostBasisPoints ?? 0;
    const amount = managedCharge(input.maximumUsd, funding).totalMicrounits;
    if (input.key.length < 8 || input.key.length > 200) throw new Error("managed_reservation_invalid");
    return await this.db.transaction(async () => {
      const previous = await this.find(input.accountId, input.key);
      if (previous) {
        if (previous.request_digest !== input.digest || previous.provider !== input.provider || previous.model !== input.model)
          throw new Error("managed_idempotency_conflict");
        return { id: String(previous.usage_id), replay: true };
      }
      await this.assertAdmitting(input.provider);
      const now = Date.now();
      const dayStart = now - now % 86_400_000;
      const budget = await this.db.raw.prepare(`SELECT COALESCE(SUM(CASE WHEN p.state='settled' THEN p.total_microunits
        ELSE h.amount_microunits END),0) AS total FROM economic_managed_purchases p
        JOIN economic_credit_holds h ON h.id=p.usage_id
        WHERE (p.state='settled' AND COALESCE(p.settled_at,p.created_at)>=?) OR p.state IN ('reserved','submitted','uncertain')`).get(dayStart);
      if (Number(budget?.total ?? 0) + amount > this.dailyLimitMicrounits) throw new Error("managed_operator_budget_exceeded");
      if (this.totalLimitMicrounits !== undefined) {
        const lifetime = await this.db.raw.prepare(`SELECT COALESCE(SUM(CASE WHEN p.state='settled' THEN p.total_microunits
          ELSE h.amount_microunits END),0) AS total FROM economic_managed_purchases p
          JOIN economic_credit_holds h ON h.id=p.usage_id
          WHERE p.state IN ('settled','reserved','submitted','uncertain')`).get();
        if (Number(lifetime?.total ?? 0) + amount > this.totalLimitMicrounits) throw new Error("managed_operator_budget_exceeded");
      }
      if ((await this.wallet.summary("account", input.accountId, now)).availableMicrounits < amount)
        throw new Error("insufficient_contribution_credits");
      await this.db.raw.prepare(`INSERT INTO economic_credit_holds
        (id,account_id,request_digest,amount_microunits,status,created_at) VALUES (?,?,?,?,'reserved',?)`)
        .run(input.usageId, input.accountId, input.digest, amount, now);
      await this.promotions?.reserve(input.usageId, input.accountId, amount, now);
      await this.db.raw.prepare(`INSERT INTO economic_managed_purchases
        (usage_id,account_id,key_digest,request_digest,provider,model,maximum_usd,state,created_at,funding_cost_basis_points)
        VALUES (?,?,?,?,?,?,?,'reserved',?,?)`).run(input.usageId, input.accountId,
          sha256CanonicalEvidence({ accountId: input.accountId, key: input.key }), input.digest,
          input.provider, input.model, input.maximumUsd, now, funding);
      return { id: input.usageId, replay: false };
    });
  }
  async assertAdmitting(provider:string) {
    if(await this.db.raw.prepare("SELECT 1 FROM economic_managed_purchases WHERE provider=? AND safety_stop=true LIMIT 1").get(provider))
      throw new Error("managed_provider_safety_stop");
  }
  /** Durable claim precedes any paid side effect. A crash/timeout is never retried as a new purchase. */
  async claim(id: string, accountId: string): Promise<boolean> {
    const result = await this.db.raw.prepare(`UPDATE economic_managed_purchases SET state='submitted'
      WHERE usage_id=? AND account_id=? AND state='reserved'`).run(id, accountId);
    return Number(result.changes) === 1;
  }
  async uncertain(id: string) {
    await this.db.raw.prepare(`UPDATE economic_managed_purchases SET state='uncertain'
      WHERE usage_id=? AND state='submitted'`).run(id);
  }
  async recordReceipt(id: string, accountId: string, receiptId: string, receipt: unknown) {
    await this.db.transaction(async()=>{
    const row=await this.db.raw.prepare("SELECT maximum_usd FROM economic_managed_purchases WHERE usage_id=? AND account_id=?").get(id,accountId);
    const cost=(receipt as {usd?:unknown}|null)?.usd;
    if(!row||typeof cost!=="string")throw new Error("managed_receipt_invalid");
    const overcharged=usdAtoms(cost)>usdAtoms(String(row.maximum_usd));
    const result = await this.db.raw.prepare(`UPDATE economic_managed_purchases
      SET provider_receipt_id=?,pending_receipt_json=?,safety_stop=CASE WHEN ?=1 THEN true ELSE false END WHERE usage_id=? AND account_id=? AND state IN ('submitted','uncertain')
      AND provider_receipt_id IS NULL`).run(receiptId, JSON.stringify(receipt), overcharged?1:0, id, accountId);
    if (Number(result.changes) !== 1) throw new Error("managed_receipt_binding_failed");
    });
  }
  /** Release only before submission, or after authoritative proof that no charge exists. */
  async release(id: string, accountId: string, confirmedUncharged = false) {
    await this.db.transaction(async () => {
      const row = await this.db.raw.prepare("SELECT * FROM economic_managed_purchases WHERE usage_id=? AND account_id=?").get(id, accountId);
      if (!row || row.state === "settled") throw new Error("managed_release_invalid");
      if (row.state !== "reserved" && row.state !== "released" && !confirmedUncharged) throw new Error("managed_charge_unconfirmed");
      await this.db.raw.prepare("UPDATE economic_managed_purchases SET state='released' WHERE usage_id=?").run(id);
      await this.wallet.release(id);
    });
  }
  async settle(input: { id: string; accountId: string; receiptId: string; usd: string; evidence: unknown }) {
    if (!input.receiptId || input.receiptId.length > 256) throw new Error("managed_receipt_invalid");
    return await this.db.transaction(async () => {
      const row = await this.db.raw.prepare(`SELECT p.*,h.amount_microunits,h.status AS hold_status FROM economic_managed_purchases p
        JOIN economic_credit_holds h ON h.id=p.usage_id WHERE p.usage_id=? AND p.account_id=?`).get(input.id, input.accountId);
      if (!row) throw new Error("managed_purchase_not_found");
      const charge = managedCharge(input.usd, Number(row.funding_cost_basis_points));
      const digest = sha256CanonicalEvidence({ receiptId: input.receiptId, charge, evidence: input.evidence });
      if (row.state === "settled") {
        if (row.receipt_digest !== digest) throw new Error("managed_receipt_conflict");
        return charge;
      }
      if (!["submitted", "uncertain"].includes(String(row.state)) || row.hold_status !== "reserved"
        || (row.provider_receipt_id !== null && row.provider_receipt_id !== input.receiptId)
        || usdAtoms(input.usd)>usdAtoms(String(row.maximum_usd))
        || charge.totalMicrounits > Number(row.amount_microunits))
        throw new Error("managed_settlement_outside_reservation");
      await this.promotions?.settle(input.id, charge.totalMicrounits);
      await this.db.raw.prepare(`UPDATE economic_managed_purchases SET state='settled',provider_receipt_id=?,
        upstream_usd=?,upstream_microunits=?,fee_microunits=?,total_microunits=?,receipt_digest=?,funding_cost_microunits=?,settled_at=? WHERE usage_id=?`)
        .run(input.receiptId, charge.upstreamUsd, charge.upstreamMicrounits, charge.serviceFeeMicrounits,
          charge.totalMicrounits, digest, charge.fundingCostMicrounits ?? 0, Date.now(), input.id);
      await this.db.raw.prepare("UPDATE economic_credit_holds SET status='settled' WHERE id=? AND status='reserved'").run(input.id);
      const summary = await this.wallet.summary("account", input.accountId);
      if (summary.balanceMicrounits < summary.reservedMicrounits) throw new Error("managed_balance_changed");
      return charge;
    });
  }
  /** Single-flight asynchronous recovery across coordinator instances. No inference POST. */
  async claimPoll(id:string,accountId:string) {
    const now=Date.now(),lease=now+240000;
    const claim=await this.db.raw.prepare(`UPDATE economic_managed_purchases SET poll_until=? WHERE usage_id=? AND account_id=?
      AND state IN ('submitted','uncertain') AND COALESCE(poll_until,0)<=?`).run(lease,id,accountId,now);
    return Number(claim.changes)===1?lease:null;
  }
  async releasePoll(id:string,lease:number) {
    await this.db.raw.prepare("UPDATE economic_managed_purchases SET poll_until=0 WHERE usage_id=? AND poll_until=?").run(id,lease);
  }
  async savePollJob(id:string,accountId:string,lease:number,job:unknown) {
    const saved=await this.db.raw.prepare(`UPDATE economic_managed_purchases SET remote_job_json=? WHERE usage_id=? AND account_id=? AND poll_until=?
      AND state IN ('submitted','uncertain')`).run(JSON.stringify(job),id,accountId,lease);
    if(Number(saved.changes)!==1)throw new Error("managed_poll_claim_lost");
  }
}
