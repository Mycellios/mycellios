import { createHash, createHmac, randomBytes } from "node:crypto";
import type { MeshDatabase } from "../storage/database.js";

export const REFERRAL_REWARD_MICROUNITS = 1_000_000;
export const REFERRAL_REWARD_DAYS = 14;
const DAY = 86_400_000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("base64url");
export const REFERRAL_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export interface ReferralAccount { userId: string; email: string | null; emailVerified?: boolean }

/** Apply with the migration owner, together with expiringPromotionSchemaSql. */
export const referralSchemaSql = `
CREATE TABLE IF NOT EXISTS referral_invites (
  account_id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE,
  email_fingerprint TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_visits (
  receipt_hash TEXT PRIMARY KEY, code TEXT NOT NULL REFERENCES referral_invites(code),
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_pending_accounts (
  account_id TEXT PRIMARY KEY, receipt_hash TEXT NOT NULL UNIQUE REFERENCES referral_visits(receipt_hash),
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_redemptions (
  account_id TEXT PRIMARY KEY, inviter_id TEXT NOT NULL REFERENCES referral_invites(account_id),
  email_fingerprint TEXT NOT NULL UNIQUE, receipt_hash TEXT NOT NULL UNIQUE REFERENCES referral_visits(receipt_hash),
  inviter_grant_id TEXT NOT NULL UNIQUE REFERENCES economic_promotional_grants(id),
  invitee_grant_id TEXT NOT NULL UNIQUE REFERENCES economic_promotional_grants(id),
  rewarded_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  CHECK(account_id <> inviter_id)
);
`;

export class Referrals {
  constructor(private readonly database: MeshDatabase, private readonly emailPepper: string) {
    if (emailPepper.length < 32) throw new Error("Referral email fingerprint key is missing");
  }
  async initialize() {
    for (const table of ["referral_invites", "referral_visits", "referral_pending_accounts", "referral_redemptions"])
      await this.database.raw.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
  }
  private email(account: ReferralAccount) {
    return account.emailVerified === true && account.email?.trim()
      ? createHmac("sha256", this.emailPepper).update("mycellios-referral-email-v1\0" + account.email.trim().toLowerCase()).digest("hex") : null;
  }
  async invite(account: ReferralAccount, now = Date.now()) {
    const fingerprint = this.email(account);
    if (!fingerprint) return null;
    return this.database.transaction(async () => {
      let row = await this.database.raw.prepare("SELECT code FROM referral_invites WHERE account_id=?").get(account.userId);
      if (!row) {
        const code = token();
        await this.database.raw.prepare("INSERT INTO referral_invites(account_id,code,email_fingerprint,created_at) VALUES (?,?,?,?)")
          .run(account.userId, code, fingerprint, now);
        row = { code };
      }
      const count = await this.database.raw.prepare("SELECT COUNT(*) AS count FROM referral_redemptions WHERE inviter_id=?").get(account.userId);
      return { code: String(row.code), rewardMicrounits: REFERRAL_REWARD_MICROUNITS,
        rewardDays: REFERRAL_REWARD_DAYS, rewardedInvites: Number(count?.count ?? 0) };
    });
  }
  /** First valid touch wins for this browser until redemption or receipt expiry. */
  async visit(code: string, previous?: string, now = Date.now()) {
    if (!REFERRAL_TOKEN.test(code)) return null;
    return this.database.transaction(async () => {
      if (previous && REFERRAL_TOKEN.test(previous)) {
        const kept = await this.database.raw.prepare(`SELECT v.receipt_hash FROM referral_visits v
          LEFT JOIN referral_redemptions r ON r.receipt_hash=v.receipt_hash
          WHERE v.receipt_hash=? AND v.expires_at>? AND r.account_id IS NULL`).get(digest(previous), now);
        if (kept) return previous;
      }
      if (!await this.database.raw.prepare("SELECT 1 FROM referral_invites WHERE code=?").get(code)) return null;
      const receipt = token();
      await this.database.raw.prepare("INSERT INTO referral_visits(receipt_hash,code,created_at,expires_at) VALUES (?,?,?,?)")
        .run(digest(receipt), code, now, now + 30 * DAY);
      return receipt;
    });
  }
  async redeem(account: ReferralAccount, receipt: string | undefined, now = Date.now()) {
    return this.database.transaction(async () => {
      const prior = await this.database.raw.prepare("SELECT rewarded_at,expires_at FROM referral_redemptions WHERE account_id=?").get(account.userId);
      if (prior) return { status: "already_awarded" as const, rewardMicrounits: REFERRAL_REWARD_MICROUNITS, expiresAt: Number(prior.expires_at) };
      // Bind to the authenticated identity before email verification. Later devices
      // recover this attribution from the account without needing its old cookie.
      const pending = await this.database.raw.prepare("SELECT receipt_hash FROM referral_pending_accounts WHERE account_id=?").get(account.userId);
      const receiptHash = pending ? String(pending.receipt_hash) : receipt && REFERRAL_TOKEN.test(receipt) ? digest(receipt) : null;
      if (!receiptHash) return { status: "no_referral" as const };
      const visit = await this.database.raw.prepare(`SELECT v.created_at,v.expires_at,i.account_id,i.email_fingerprint
        FROM referral_visits v JOIN referral_invites i ON i.code=v.code WHERE v.receipt_hash=?`).get(receiptHash);
      const owner = await this.database.raw.prepare("SELECT created_at FROM api_accounts WHERE user_id=?").get(account.userId);
      if (!visit || Number(visit.expires_at) <= now || !owner || Number(owner.created_at) < Number(visit.created_at) ||
          visit.account_id === account.userId ||
          await this.database.raw.prepare("SELECT 1 FROM referral_pending_accounts WHERE receipt_hash=? AND account_id<>?").get(receiptHash, account.userId))
        return { status: "not_eligible" as const };
      const fingerprint = this.email(account);
      if (fingerprint && (visit.email_fingerprint === fingerprint ||
          await this.database.raw.prepare("SELECT 1 FROM referral_redemptions WHERE email_fingerprint=? OR receipt_hash=?").get(fingerprint, receiptHash)))
        return { status: "not_eligible" as const };
      if (!pending) await this.database.raw.prepare("INSERT INTO referral_pending_accounts(account_id,receipt_hash,created_at) VALUES(?,?,?)").run(account.userId, receiptHash, now);
      if (!fingerprint) return { status: "verification_required" as const };
      const expiresAt = now + REFERRAL_REWARD_DAYS * DAY;
      const inviterGrantId = "referral_" + digest("v1:inviter:" + account.userId);
      const inviteeGrantId = "referral_" + digest("v1:invitee:" + account.userId);
      for (const [id, accountId, reason] of [[inviterGrantId, String(visit.account_id), "referral-v1:inviter"], [inviteeGrantId, account.userId, "referral-v1:invitee"]]) {
        await this.database.raw.prepare(`INSERT INTO economic_promotional_grants(id,account_id,issued_by,reason,amount_microunits,created_at,expires_at)
          VALUES (?,?,?, ?,?,?,?)`).run(id!, accountId!, "referral-v1", reason!, REFERRAL_REWARD_MICROUNITS, now, expiresAt);
      }
      await this.database.raw.prepare(`INSERT INTO referral_redemptions(account_id,inviter_id,email_fingerprint,receipt_hash,inviter_grant_id,invitee_grant_id,rewarded_at,expires_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(account.userId, String(visit.account_id), fingerprint, receiptHash, inviterGrantId, inviteeGrantId, now, expiresAt);
      return { status: "awarded" as const, rewardMicrounits: REFERRAL_REWARD_MICROUNITS, expiresAt };
    });
  }
}
