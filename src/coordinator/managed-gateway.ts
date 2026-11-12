import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { MeshDatabase } from "../storage/database.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import type { ManagedPurchases } from "../economy/managed-purchases.js";
import type { ManagedOpenRouter, ManagedTextRequest, ManagedTextResult } from "./managed-openrouter.js";
import type { ChatCompletionRequest } from "../contracts/types.js";
import type { ManagedModel } from "../contracts/managed-provider.js";
export interface GatewayQuote { maximumUsd:string; maximumMicrounits:number; expiresAt:number; body:{max_tokens?:number};provider?:string;fundingCostBasisPoints?:number;billingContext?:unknown }
export interface GatewayProvider<R,Q,C> {
 provider:string; ensureFresh():Promise<void>; catalog():C[]; quote(request:R):Q;
 execute(quote:Q,onChunk?: (v:Record<string,unknown>)=>void,onSubmitted?: (job:unknown)=>Promise<void>,privatePayload?:unknown):Promise<ManagedTextResult>;
  recover?(job:unknown):Promise<ManagedTextResult|null>;
}

interface UsageAccess {
  beginUsage(account: string, key: string | null, request: ChatCompletionRequest, funded: true): Promise<{ id: string }>;
  completeUsage(id: string, input: number, output: number): unknown;
  failUsage(id: string, code: string): unknown;
}
/** Explicit quote acceptance, account binding and one durable submission. No implicit paid fallback. */
export class ManagedGateway<R extends {model:string}=ManagedTextRequest,Q extends GatewayQuote=ReturnType<ManagedOpenRouter["quote"]>,C=ManagedModel> {
  private readonly signingKey = randomBytes(32);
  constructor(private readonly db: MeshDatabase, private readonly purchases: ManagedPurchases,
    private readonly usage: UsageAccess, private readonly provider: GatewayProvider<R,Q,C>,
    private readonly requestLimitMicrounits: number) {
    if (!Number.isSafeInteger(requestLimitMicrounits) || requestLimitMicrounits < 1) throw new Error("managed_budget_invalid");
  }
  async catalog() {
    // Metadata refresh must never delay the native catalog during an external outage.
    void this.provider.ensureFresh().catch(() => {});
    return this.provider.catalog();
  }
  async quote(accountId: string, request: R) {
    await this.provider.ensureFresh();
    const quote = this.provider.quote(request);
    await this.purchases.assertAdmitting(quote.provider??this.provider.provider);
    if (quote.maximumMicrounits > this.requestLimitMicrounits) throw new Error("managed_operator_budget_exceeded");
    const value = { accountId, digest: sha256CanonicalEvidence(request), maximum: quote.maximumMicrounits,
      expires: Math.min(quote.expiresAt, Date.now() + 60_000), executionDigest: sha256CanonicalEvidence({body:quote.body,fundingCostBasisPoints:quote.fundingCostBasisPoints??0,billingContext:quote.billingContext??null}) };
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    const mac = createHmac("sha256", this.signingKey).update(payload).digest("base64url");
    return { provider: "Mycellios", processing: "external", currency: "credits", serviceFeeBasisPoints: 400,
      fundingCostBasisPoints:quote.fundingCostBasisPoints??0,
      maximumMicrounits: value.maximum, expiresAt: value.expires, token: `${payload}.${mac}` };
  }
  private verify(accountId: string, request: R, token: string) {
    if (token.length > 2048) throw new Error("managed_quote_invalid");
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error("managed_quote_invalid");
    const expected = createHmac("sha256", this.signingKey).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("managed_quote_invalid");
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      accountId: string; digest: string; maximum: number; expires: number; executionDigest:string };
    if (value.accountId !== accountId || value.digest !== sha256CanonicalEvidence(request) || Date.now() >= value.expires)
      throw new Error("managed_quote_expired_or_changed");
    return value;
  }
  async replayFor(accountId: string, key: string, request: R) {
    const row = await this.purchases.find(accountId, key);
    if (!row) return null;
    const replay = this.replay(row, sha256CanonicalEvidence(request));
    // Retrying the same compatible chat checks the old receipt, never re-quotes
    // or submits another inference. No dedicated recovery UI is needed.
    if (replay.status === "pending_reconciliation" && this.provider.recover && typeof row.remote_job_json === "string")
      return this.reconcile(accountId,key);
    return replay;
  }
  async execute(accountId: string, apiKeyId: string | null, key: string, request: R, token: string,
    onChunk?: (value: Record<string, unknown>) => void, privatePayload?:unknown) {
    const digest = sha256CanonicalEvidence(request);
    if (key.length < 8 || key.length > 200) throw new Error("managed_idempotency_required");
    // A lost response can be recovered with the same account/key even after a quote expires.
    const previous = await this.purchases.find(accountId, key);
    if (previous) return this.replay(previous, digest);
    const accepted = this.verify(accountId, request, token);
    await this.provider.ensureFresh();
    const quote = this.provider.quote(request);
    if (quote.maximumMicrounits > accepted.maximum || quote.maximumMicrounits > this.requestLimitMicrounits
      || sha256CanonicalEvidence({body:quote.body,fundingCostBasisPoints:quote.fundingCostBasisPoints??0,billingContext:quote.billingContext??null})!==accepted.executionDigest)
      throw new Error("managed_price_changed");
    const reservation = await this.db.transaction(async () => {
      // Serialize beginUsage with reservation, so a failed/replayed hold never leaves an orphan API usage.
      const existing = await this.purchases.find(accountId, key);
      if (existing) return { id: String(existing.usage_id), replay: existing };
      const usage = await this.usage.beginUsage(accountId, apiKeyId, {
        // Credit-funded API admission counts requests/concurrency, not estimated prompt tokens.
        model: request.model, messages: [], ...(quote.body.max_tokens===undefined?{}:{max_tokens:quote.body.max_tokens}) }, true);
      await this.purchases.reserve({ usageId: usage.id, accountId, key, digest, provider: quote.provider??this.provider.provider,
        model: request.model, maximumUsd: quote.maximumUsd, fundingCostBasisPoints:quote.fundingCostBasisPoints??0 });
      return { id: usage.id, replay: null };
    });
    if (reservation.replay) return this.replay(reservation.replay, digest);
    if (!(await this.purchases.claim(reservation.id, accountId))) throw new Error("managed_submission_in_progress");
    try {
      const result = await this.provider.execute(quote, onChunk, async job => {
        const saved = await this.db.raw.prepare("UPDATE economic_managed_purchases SET remote_job_json=? WHERE usage_id=? AND state='submitted'")
          .run(JSON.stringify(job),reservation.id);
        if (Number(saved.changes) !== 1) throw new Error("managed_submission_claim_lost");
      },privatePayload);
      await this.purchases.recordReceipt(reservation.id, accountId, result.receiptId, result);
      return await this.finish(reservation.id, accountId, result);
    } catch {
      // Timeout, rejected response or missing actual-cost receipt: retain the hold for reconciliation.
      // Never retry a paid POST, invent usage, or mark this account's pending purchase as refunded.
      await this.purchases.uncertain(reservation.id);
      return { status: "pending_reconciliation" as const, requestId: reservation.id };
    }
  }
  async completeKnown(id:string,accountId:string,result:ManagedTextResult) {
    await this.purchases.recordReceipt(id,accountId,result.receiptId,result);
    return await this.finish(id,accountId,result);
  }
  /** Recovery consumes only a previously stored server receipt, never another inference POST. */
  async reconcile(accountId: string, key: string) {
    const row = await this.purchases.find(accountId, key);
    if (!row || row.state === "released") throw new Error("managed_receipt_missing");
    if (row.state === "settled" && typeof row.response_json === "string")
      return {status:"completed" as const,response:JSON.parse(row.response_json) as Record<string,unknown>};
    if (typeof row.pending_receipt_json !== "string" && this.provider.recover && typeof row.remote_job_json === "string") {
      const lease = await this.purchases.claimPoll(String(row.usage_id),accountId);
      if (lease === null) return {status:"pending_reconciliation" as const,requestId:String(row.usage_id)};
      try {
        const result = await this.provider.recover(JSON.parse(row.remote_job_json));
        if (result) return await this.completeKnown(String(row.usage_id),accountId,result);
        return {status:"pending_reconciliation" as const,requestId:String(row.usage_id)};
      } finally { await this.purchases.releasePoll(String(row.usage_id),lease); }
    }
    if (typeof row.pending_receipt_json !== "string") throw new Error("managed_receipt_missing");
    return await this.finish(String(row.usage_id), accountId, JSON.parse(row.pending_receipt_json) as ManagedTextResult);
  }
  private async finish(id: string, accountId: string, result: ManagedTextResult) {
      const settled = await this.db.transaction(async () => {
        const charge = await this.purchases.settle({ id, accountId, receiptId: result.receiptId,
          usd: result.usd, evidence: { model: result.response.model, input: result.inputTokens, output: result.outputTokens } });
        const response: Record<string, unknown> = { ...result.response, mycellios: { provider: "Mycellios", processing: "external",
          fundingCostBasisPoints:charge.fundingCostBasisPoints??0,
          fundingCostMicrounits:charge.fundingCostMicrounits??0,serviceFeeMicrounits:charge.serviceFeeMicrounits,
          creditsMicrounits: charge.totalMicrounits, serviceFeeBasisPoints: 400, requestId: id } };
        await this.db.raw.prepare("UPDATE economic_managed_purchases SET response_json=? WHERE usage_id=?")
          .run(JSON.stringify(response), id);
        await this.usage.completeUsage(id, result.inputTokens, result.outputTokens);
        return response;
      });
      return { status: "completed" as const, response: settled };
  }
  private replay(row: Record<string, unknown>, digest: string) {
    if (row.request_digest !== digest) throw new Error("managed_idempotency_conflict");
    if (row.state === "settled" && typeof row.response_json === "string")
      return { status: "completed" as const, response: JSON.parse(row.response_json) as Record<string, unknown> };
    return { status: row.state === "released" ? "released" as const : "pending_reconciliation" as const,
      requestId: String(row.usage_id) };
  }
}
