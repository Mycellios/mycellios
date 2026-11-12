import type { MeshDatabase } from "../storage/database.js";

/** Migration-owner only. Legacy promotions retain their original non-expiring behavior. */
export const expiringPromotionSchemaSql = `
ALTER TABLE economic_promotional_grants ADD COLUMN IF NOT EXISTS expires_at BIGINT;
CREATE TABLE IF NOT EXISTS economic_promotion_allocations (
  hold_id TEXT NOT NULL REFERENCES economic_credit_holds(id),
  grant_id TEXT NOT NULL REFERENCES economic_promotional_grants(id),
  reserved_microunits BIGINT NOT NULL CHECK(reserved_microunits > 0),
  spent_microunits BIGINT NOT NULL DEFAULT 0 CHECK(spent_microunits >= 0 AND spent_microunits <= reserved_microunits),
  PRIMARY KEY(hold_id, grant_id)
);
CREATE INDEX IF NOT EXISTS economic_promotion_allocations_grant ON economic_promotion_allocations(grant_id);
`;

export class PromotionalCredits {
  constructor(private readonly database: MeshDatabase) {}

  async totals(accountId?: string, now = Date.now()) {
    const row = await this.database.raw.prepare(`WITH amounts AS (
      SELECT g.id,g.amount_microunits,g.expires_at,
        COALESCE(SUM(a.spent_microunits),0) AS spent,
        COALESCE(SUM(CASE WHEN h.status='reserved' THEN a.reserved_microunits ELSE 0 END),0) AS held
      FROM economic_promotional_grants g
      LEFT JOIN economic_promotion_allocations a ON a.grant_id=g.id
      LEFT JOIN economic_credit_holds h ON h.id=a.hold_id
      ${accountId === undefined ? "" : "WHERE g.account_id=?"}
      GROUP BY g.id,g.amount_microunits,g.expires_at
    ) SELECT COALESCE(SUM(amount_microunits),0) AS granted,
      COALESCE(SUM(CASE WHEN expires_at IS NOT NULL AND expires_at<=? THEN amount_microunits-spent-held ELSE 0 END),0) AS expired,
      COALESCE(SUM(CASE WHEN expires_at IS NULL OR expires_at>? THEN amount_microunits-spent-held ELSE 0 END),0) AS available,
      MIN(CASE WHEN expires_at>? AND amount_microunits>spent+held THEN expires_at END) AS next_expiry
      FROM amounts`).get(...(accountId === undefined ? [] : [accountId]), now, now, now);
    return { granted: Number(row?.granted ?? 0), expired: Number(row?.expired ?? 0),
      available: Number(row?.available ?? 0), nextExpiry: row?.next_expiry == null ? null : Number(row.next_expiry) };
  }

  /** Must share the wallet writer transaction with hold creation. */
  async reserve(holdId: string, accountId: string, maximum: number, now: number) {
    const rows = await this.database.raw.prepare(`SELECT g.id,g.amount_microunits,g.expires_at,g.created_at,
      COALESCE(SUM(a.spent_microunits),0) AS spent,
      COALESCE(SUM(CASE WHEN h.status='reserved' THEN a.reserved_microunits ELSE 0 END),0) AS held
      FROM economic_promotional_grants g
      LEFT JOIN economic_promotion_allocations a ON a.grant_id=g.id
      LEFT JOIN economic_credit_holds h ON h.id=a.hold_id
      WHERE g.account_id=? AND g.expires_at>?
      GROUP BY g.id,g.amount_microunits,g.expires_at,g.created_at
      ORDER BY g.expires_at ASC NULLS LAST,g.created_at ASC,g.id ASC`).all(accountId, now);
    let remaining = maximum;
    for (const row of rows) {
      const amount = Math.min(remaining, Math.max(0, Number(row.amount_microunits) - Number(row.spent) - Number(row.held)));
      if (!amount) continue;
      await this.database.raw.prepare(`INSERT INTO economic_promotion_allocations(hold_id,grant_id,reserved_microunits) VALUES (?,?,?)`)
        .run(holdId, String(row.id), amount);
      remaining -= amount;
      if (!remaining) break;
    }
  }

  /** Freeze exact promotional consumption before the hold stops reserving its allowance. */
  async settle(holdId: string, actual: number) {
    const rows = await this.database.raw.prepare(`SELECT a.grant_id,a.reserved_microunits FROM economic_promotion_allocations a
      JOIN economic_promotional_grants g ON g.id=a.grant_id WHERE a.hold_id=?
      ORDER BY g.expires_at ASC NULLS LAST,g.created_at ASC,g.id ASC`).all(holdId);
    let remaining = actual;
    for (const row of rows) {
      const spent = Math.min(remaining, Number(row.reserved_microunits));
      await this.database.raw.prepare(`UPDATE economic_promotion_allocations SET spent_microunits=? WHERE hold_id=? AND grant_id=?`)
        .run(spent, holdId, String(row.grant_id));
      remaining -= spent;
    }
  }
}
