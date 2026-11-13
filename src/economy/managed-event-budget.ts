import type { MeshDatabase } from "../storage/database.js";
export interface ManagedEventBudget {
  campaignId: string; maximumMicrounits: number; startsAt: number; endsAt: number;
}
/** Called inside the normal serialized reservation transaction. The global funded
 * lifetime ceiling still includes both event and ordinary purchases. */
export async function managedAdmissionBudget(db: MeshDatabase, accountId: string, now: number,
  normalDailyLimit: number, event?: ManagedEventBudget) {
  const guest = event ? await db.raw.prepare("SELECT 1 FROM economic_demo_guests WHERE campaign_id=? AND account_id=?")
    .get(event.campaignId, accountId) : null;
  if (guest && event && (now < event.startsAt || now >= event.endsAt)) throw new Error("managed_event_expired");
  const dayStart = now - now % 86_400_000;
  const group = event ? `${guest ? "EXISTS" : "NOT EXISTS"} (SELECT 1 FROM economic_demo_guests g
    WHERE g.account_id=p.account_id AND g.campaign_id=?)` : "true";
  const row = await db.raw.prepare(`SELECT COALESCE(SUM(CASE WHEN p.state='settled' THEN p.total_microunits
    ELSE h.amount_microunits END),0) AS total FROM economic_managed_purchases p
    JOIN economic_credit_holds h ON h.id=p.usage_id
    WHERE ${group} AND (${guest ? "p.state IN ('settled','reserved','submitted','uncertain')"
      : "(p.state='settled' AND COALESCE(p.settled_at,p.created_at)>=?) OR p.state IN ('reserved','submitted','uncertain')"})`)
    .get(...(event ? [event.campaignId] : []), ...(guest ? [] : [dayStart]));
  return { used: Number(row?.total ?? 0), limit: guest && event ? event.maximumMicrounits : normalDailyLimit };
}
