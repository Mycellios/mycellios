import { randomUUID } from "node:crypto";
import type { MeshDatabase } from "../storage/database.js";
import { sha256CanonicalEvidence } from "../core/json.js";
/** Server supplies its signature-checked envelope adapter; the engine has no HTTP dependency. */
interface PaymentVerifier { verifyEvent(raw:Buffer,signature:string):{id:string;type:string;data:{object:Record<string,unknown>}} }

export const walletTopupsSchemaSql = `
CREATE TABLE IF NOT EXISTS economic_wallet_topups (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL, key_digest TEXT NOT NULL,
 amount_microunits BIGINT NOT NULL CHECK(amount_microunits>0), created_at BIGINT NOT NULL,
 checkout_id TEXT UNIQUE, payment_id TEXT UNIQUE, credited BOOLEAN NOT NULL DEFAULT false,
 refunded_microunits BIGINT NOT NULL DEFAULT 0 CHECK(refunded_microunits>=0 AND refunded_microunits<=amount_microunits),
 UNIQUE(account_id,key_digest)
);
CREATE TABLE IF NOT EXISTS economic_wallet_payment_events (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL
);
REVOKE ALL ON economic_wallet_topups,economic_wallet_payment_events FROM PUBLIC;
ALTER TABLE economic_wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE economic_wallet_payment_events ENABLE ROW LEVEL SECURITY;
`;
export function walletTopupsAccessSchemaSql(nativeRole:string) {
 if(!/^[a-z_][a-z_0-9]{0,62}$/.test(nativeRole))throw new Error("wallet_role_invalid");
 return ["economic_wallet_topups","economic_wallet_payment_events"].map(table=>`
  DROP POLICY IF EXISTS wallet_native_access ON ${table};
  CREATE POLICY wallet_native_access ON ${table} TO "${nativeRole}" USING(true) WITH CHECK(true);
  GRANT SELECT,INSERT,UPDATE ON ${table} TO "${nativeRole}";`).join("\n");
}
export class WalletTopups {
 constructor(private readonly db: MeshDatabase) {}
 async initialize() { await this.db.raw.prepare("SELECT id,credited,refunded_microunits FROM economic_wallet_topups LIMIT 0").all(); }
 async quote(account: string, dollars: number, key: string) {
  if (![5,10,20,50].includes(dollars) || key.length<8 || key.length>200) throw new Error("wallet_topup_invalid");
  return await this.db.transaction(async()=>{
   const digest=sha256CanonicalEvidence({account,key});
   const old=await this.db.raw.prepare("SELECT * FROM economic_wallet_topups WHERE account_id=? AND key_digest=?").get(account,digest);
   if(old) { if(Number(old.amount_microunits)!==dollars*1000000) throw new Error("wallet_topup_conflict"); return old; }
   const id=randomUUID();
   await this.db.raw.prepare("INSERT INTO economic_wallet_topups(id,account_id,key_digest,amount_microunits,created_at) VALUES (?,?,?,?,?)")
    .run(id,account,digest,dollars*1000000,Date.now());
   return (await this.db.raw.prepare("SELECT * FROM economic_wallet_topups WHERE id=?").get(id))!;
  });
 }
 async bind(id:string, checkout:string) {
  const result=await this.db.raw.prepare("UPDATE economic_wallet_topups SET checkout_id=? WHERE id=? AND (checkout_id IS NULL OR checkout_id=?)").run(checkout,id,checkout);
  if(Number(result.changes)!==1) throw new Error("wallet_checkout_conflict");
 }
 /** Only the shared verified Stripe envelope enters this method; never browser amounts. */
 async receive(verifier:PaymentVerifier, raw:Buffer, signature:string) {
  const event=verifier.verifyEvent(raw,signature), obj=event.data.object;
  return await this.db.transaction(async()=>{
   const digest=sha256CanonicalEvidence(event);
   const old=await this.db.raw.prepare("SELECT digest FROM economic_wallet_payment_events WHERE id=?").get(event.id);
   if(old) { if(old.digest!==digest) throw new Error("wallet_event_conflict"); return {duplicate:true}; }
   if(event.type==="checkout.session.completed" || event.type==="checkout.session.async_payment_succeeded") {
    const meta=obj.metadata as Record<string,unknown>|undefined;
    if(meta?.purpose!=="mycellios-wallet-v1") return {ignored:true};
    const row=await this.db.raw.prepare("SELECT * FROM economic_wallet_topups WHERE id=?").get(String(meta.quote_id));
    if(!row || row.checkout_id!==obj.id || obj.mode!=="payment" || obj.payment_status!=="paid" || obj.currency!=="usd"
     || obj.amount_total!==Number(row.amount_microunits)/10000 || typeof obj.payment_intent!=="string"
     || (row.payment_id!==null && row.payment_id!==obj.payment_intent)
     || meta.account_id!==row.account_id) throw new Error("wallet_payment_mismatch");
    await this.db.raw.prepare("UPDATE economic_wallet_topups SET credited=true,payment_id=? WHERE id=?").run(obj.payment_intent,String(row.id));
   } else if(event.type==="charge.refunded") {
    const meta=obj.metadata as Record<string,unknown>|undefined;
    let row=typeof obj.payment_intent==="string" ? await this.db.raw.prepare("SELECT * FROM economic_wallet_topups WHERE payment_id=?").get(obj.payment_intent):undefined;
    if(!row && meta?.purpose==="mycellios-wallet-v1" && typeof meta.quote_id==="string")
      row=await this.db.raw.prepare("SELECT * FROM economic_wallet_topups WHERE id=?").get(meta.quote_id);
    if(!row) {
     if((obj.metadata as Record<string,unknown>|undefined)?.purpose==="mycellios-wallet-v1")throw new Error("wallet_refund_waits_for_payment");
     return {ignored:true};
    }
    if(obj.currency!=="usd" || obj.amount!==Number(row.amount_microunits)/10000 || !Number.isSafeInteger(obj.amount_refunded)
      || typeof obj.payment_intent!=="string" || (row.payment_id!==null && row.payment_id!==obj.payment_intent)
      || Number(obj.amount_refunded)<0 || Number(obj.amount_refunded)>Number(obj.amount)) throw new Error("wallet_refund_mismatch");
    // Stripe reports cumulative refunds. Old/reordered events cannot revive a refund.
    await this.db.raw.prepare("UPDATE economic_wallet_topups SET payment_id=?,refunded_microunits=GREATEST(refunded_microunits,?) WHERE id=?")
     .run(String(obj.payment_intent),Number(obj.amount_refunded)*10000,String(row.id));
   } else return {ignored:true};
   await this.db.raw.prepare("INSERT INTO economic_wallet_payment_events(id,digest) VALUES (?,?)").run(event.id,digest);
   return {duplicate:false};
  });
 }
}
