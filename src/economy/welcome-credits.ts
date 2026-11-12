import { createHash } from "node:crypto";
import type { MeshDatabase } from "../storage/database.js";

export const WELCOME_CREDIT_MICROUNITS = 200_000;

/** Server-owned promotional balance: one grant per verified account, never a top-up. */
export async function grantWelcomeCredits(
  database: MeshDatabase,
  account: { userId: string; emailVerified?: boolean },
  now = Date.now(),
) {
  if (!account.userId || account.emailVerified !== true) return false;
  const id = "welcome_v1_" + createHash("sha256").update(account.userId).digest("hex");
  // The unique ledger id makes concurrent sign-in, refresh and lost responses safe.
  const result = await database.raw.prepare(`INSERT INTO economic_promotional_grants
    (id,account_id,issued_by,reason,amount_microunits,created_at)
    SELECT ?,?,'welcome-v1','verified-account-welcome',?,?
    WHERE EXISTS (SELECT 1 FROM api_accounts WHERE user_id=?)
    ON CONFLICT (id) DO NOTHING RETURNING id`)
    .get(id, account.userId, WELCOME_CREDIT_MICROUNITS, now, account.userId);
  return Boolean(result);
}
