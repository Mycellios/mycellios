import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { browserInferenceOfferSchema, browserInferenceRequestSchema,
  type BrowserInferenceOffer, type BrowserInferenceRequest } from "../contracts/browser-inference.js";
import { sha256CanonicalEvidence } from "../core/json.js";
import { managedCharge } from "../economy/managed-pricing.js";
import { browserTextResultSchema } from "../contracts/browser-text.js";
import { ManagedPurchases } from "../economy/managed-purchases.js";
import type { ManagedEventBudget } from "../economy/managed-event-budget.js";
import type { MeshDatabase } from "../storage/database.js";
import type { ContributionCreditWallet } from "../economy/contribution-credit-wallet.js";
import type { ApiAccessManager } from "./api-access.js";
import type { MobileComputeHub } from "./mobile-compute-hub.js";

const provider = "mycellios-browser";
type BrowserInferenceResult = { status: string; requestId: string; [key: string]: unknown };
const usd = (micro: number) => `${Math.floor(micro / 1_000_000)}.${String(micro % 1_000_000).padStart(6, "0")}`;
const bindingSchema = z.object({ workerId: z.string(), accountId: z.string(), fingerprint: z.string(),
  artifactId: z.string(), cost: z.number().int().positive(), digest: z.string(), deadline: z.number().int().positive(),
  kind: z.literal("text").optional(), model: z.string().optional() }).strict();
const receiptSchema = z.object({ binding: bindingSchema, evidenceDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  outputBase64: z.string().min(4).max(2 * 1024 * 1024), cost: z.number().int().positive().optional() }).strict();

/** Reference-verified browser expert work. Independent of native physical-GPU evidence and suppliers. */
export class BrowserInference {
  private readonly purchases: ManagedPurchases;
  private readonly offers: BrowserInferenceOffer[];
  private readonly quoteKey = randomBytes(32);
  private contributorCursor = 0;
  constructor(private readonly db: MeshDatabase, wallet: ContributionCreditWallet,
    private readonly usage: ApiAccessManager, private readonly hub: MobileComputeHub,
    offers: BrowserInferenceOffer[], dailyLimitMicrounits: number, eventBudget?: ManagedEventBudget) {
    // An empty catalog closes admission while retaining receipt/lease recovery.
    this.offers = z.array(browserInferenceOfferSchema).max(32).parse(offers);
    if (new Set(this.offers.map(o => o.model)).size !== this.offers.length) throw new Error("browser_offer_duplicate");
    this.purchases = new ManagedPurchases(db, wallet, dailyLimitMicrounits, undefined, eventBudget);
  }
  async initialize() {
    await this.purchases.initialize();
    for (const table of ["economic_browser_contributors", "economic_browser_inference_credits"]) {
      await this.db.raw.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
      const row = await this.db.raw.prepare(`SELECT c.relrowsecurity AS protected FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname=?`).get(table);
      if (!row?.protected) throw new Error("browser_private_storage_required");
    }
    await this.recoverExpired();
  }
  /** Bounded local-lease recovery. Never dispatches work or drops a verified receipt. */
  async recoverExpired() {
    const rows = await this.db.raw.prepare(`SELECT usage_id,account_id,remote_job_json FROM economic_managed_purchases
      WHERE provider=? AND state IN ('reserved','submitted','uncertain') AND pending_receipt_json IS NULL
      AND created_at<? ORDER BY created_at LIMIT 100`).all(provider, Date.now() - 120_000);
    for (const row of rows) {
      const binding = bindingSchema.safeParse(JSON.parse(String(row.remote_job_json)));
      if (!binding.success || binding.data.deadline >= Date.now()) continue;
      await this.expire(String(row.usage_id), String(row.account_id));
    }
  }
  private async expire(id: string, accountId: string) {
    await this.db.transaction(async () => {
      const current = await this.db.raw.prepare(`SELECT state,pending_receipt_json FROM economic_managed_purchases
        WHERE usage_id=? AND account_id=? AND provider=?`).get(id, accountId, provider);
      if (current && current.pending_receipt_json === null && ["reserved", "submitted", "uncertain"].includes(String(current.state))) {
        await this.purchases.release(id, accountId, true);
        await this.usage.failUsage(id, "browser_inference_expired");
      }
    });
  }
  models() { return this.offers.map(o => "kind" in o
    ? { ...o, processing: "mycellios-network", creditsMicrounitsPerToken: managedCharge(usd(o.costMicrounitsPerToken)).totalMicrounits,
      name: "GPT-2 · 124M · Browser", modalities: ["text"], tools: false, experimental: true }
    : { ...o, processing: "mycellios-network", creditsMicrounitsPerRow: managedCharge(usd(o.costMicrounitsPerRow)).totalMicrounits }); }
  async bind(accountId: string, workerId: string, token: string) {
    const identity = this.hub.contributorIdentity(workerId, token);
    if (!identity) throw new Error("browser_ownership_proof_invalid");
    await this.db.transaction(async () => {
      const previous = await this.db.raw.prepare("SELECT * FROM economic_browser_contributors WHERE worker_id=?").get(workerId);
      if (previous && (previous.account_id !== accountId || previous.credential_fingerprint !== identity.fingerprint || previous.revoked_at !== null))
        throw new Error("browser_ownership_conflict");
      await this.db.raw.prepare(`INSERT INTO economic_browser_contributors
        (worker_id,browser_id,credential_fingerprint,account_id,linked_at) VALUES (?,?,?,?,?) ON CONFLICT(worker_id) DO NOTHING`)
        .run(workerId, identity.browserId, identity.fingerprint, accountId, Date.now());
    });
    return { linked: true };
  }
  async unbind(accountId: string, workerId: string) {
    await this.db.raw.prepare("UPDATE economic_browser_contributors SET revoked_at=? WHERE worker_id=? AND account_id=?")
      .run(Date.now(), workerId, accountId);
    return { linked: false };
  }
  quote(accountId: string, value: unknown) {
    const request = browserInferenceRequestSchema.parse(value);
    const { offer, maximumCost } = this.plan(request);
    const charge = managedCharge(usd(maximumCost));
    const body = Buffer.from(JSON.stringify({ accountId, digest: sha256CanonicalEvidence(request),
      offer: sha256CanonicalEvidence(offer), expires: Date.now() + 60_000 })).toString("base64url");
    return { token: body + "." + this.sign(body), creditsMicrounits: charge.totalMicrounits,
      earnedMicrounits: charge.upstreamMicrounits, serviceFeeMicrounits: charge.serviceFeeMicrounits };
  }
  private sign(body: string) { return createHmac("sha256", this.quoteKey).update(body).digest("base64url"); }
  private plan(request: BrowserInferenceRequest) {
    const offer = this.offers.find(o => o.model === request.model);
    if (!offer) throw new Error("browser_offer_unavailable");
    if ("kind" in request) {
      if (!("kind" in offer) || request.maxTokens > offer.maxOutputTokens) throw new Error("browser_offer_unavailable");
      const inputTokens = this.hub.textHub.inputTokens(request.prompt);
      return { offer, maximumCost: (inputTokens + request.maxTokens) * offer.costMicrounitsPerToken };
    }
    if ("kind" in offer || request.rows > offer.maxRows) throw new Error("browser_offer_unavailable");
    return { offer, maximumCost: offer.costMicrounitsPerRow * request.rows };
  }
  private async replay(accountId: string, key: string, digest?: string): Promise<BrowserInferenceResult | null> {
    const row = await this.purchases.find(accountId, key);
    if (!row) return null;
    if (row.provider !== provider || (digest && row.request_digest !== digest)) throw new Error("browser_idempotency_conflict");
    if (row.state === "settled" && typeof row.response_json === "string") return JSON.parse(row.response_json);
    if (typeof row.pending_receipt_json === "string") return await this.finish(String(row.usage_id), accountId);
    if (["reserved", "submitted", "uncertain"].includes(String(row.state)) && typeof row.remote_job_json === "string"
      && bindingSchema.parse(JSON.parse(row.remote_job_json)).deadline < Date.now()) {
      // No verified receipt and a hard-expired local lease: no supplier could have charged us.
      await this.expire(String(row.usage_id), accountId);
      return this.replay(accountId, key, digest);
    }
    return { status: row.state === "released" ? "failed" : "pending", requestId: String(row.usage_id) };
  }
  status(accountId: string, key: string) { return this.replay(accountId, key); }
  replayRequest(accountId: string, key: string, value: unknown) {
    return this.replay(accountId, key, sha256CanonicalEvidence(browserInferenceRequestSchema.parse(value)));
  }
  async execute(accountId: string, apiKeyId: string | null, key: string, value: unknown, token: string) {
    const request = browserInferenceRequestSchema.parse(value), digest = sha256CanonicalEvidence(request);
    if (key.length < 8 || key.length > 200) throw new Error("browser_idempotency_required");
    const replay = await this.replay(accountId, key, digest);
    if (replay) return replay;
    const [body, signature, extra] = token.split(".");
    if (!body || !signature || extra || signature.length !== 43 || token.length > 2048
      || !timingSafeEqual(Buffer.from(signature), Buffer.from(this.sign(body)))) throw new Error("browser_quote_invalid");
    const quote = JSON.parse(Buffer.from(body, "base64url").toString()) as Record<string, unknown>;
    const { offer, maximumCost } = this.plan(request);
    if (quote.accountId !== accountId || quote.digest !== digest || quote.offer !== sha256CanonicalEvidence(offer)
      || typeof quote.expires !== "number" || quote.expires <= Date.now()) throw new Error("browser_quote_expired_or_changed");
    const connected = this.hub.availableContributors("kind" in request ? "text" : "expert");
    if (!connected.length) throw new Error("browser_contributor_unavailable");
    const offset = this.contributorCursor % connected.length;
    const available = [...connected.slice(offset), ...connected.slice(0, offset)].slice(0, 128);
    this.contributorCursor = (offset + 1) % connected.length;
    // Read only a bounded window of current sessions, never the historical owner table.
    const owners = await this.db.raw.prepare(`SELECT * FROM economic_browser_contributors WHERE revoked_at IS NULL
      AND worker_id IN (${available.map(() => "?").join(",")})`).all(...available.map(p => p.workerId));
    const peer = available.find(p => owners.some(o => o.worker_id === p.workerId && o.credential_fingerprint === p.fingerprint));
    const owner = peer && owners.find(o => o.worker_id === peer.workerId && o.credential_fingerprint === peer.fingerprint);
    if (!peer || !owner) throw new Error("browser_contributor_unavailable");
    const binding = bindingSchema.parse({ workerId: peer.workerId, accountId: owner.account_id,
      fingerprint: peer.fingerprint, artifactId: offer.artifactId, cost: maximumCost, digest,
      ...("kind" in request ? { kind: "text", model: request.model } : {}),
      deadline: Date.now() + 120_000 });
    const reserved = await this.db.transaction(async () => {
      const prior = await this.purchases.find(accountId, key);
      if (prior) return { id: String(prior.usage_id), replay: true };
      const current = await this.db.raw.prepare("SELECT * FROM economic_browser_contributors WHERE worker_id=? AND revoked_at IS NULL").get(peer.workerId);
      if (!current || current.account_id !== binding.accountId || current.credential_fingerprint !== binding.fingerprint)
        throw new Error("browser_ownership_changed");
      const usage = await this.usage.beginUsage(accountId, apiKeyId, { model: request.model, messages: [] }, true);
      const reservation = await this.purchases.reserve({ usageId: usage.id, accountId, key, digest,
        provider, model: request.model, maximumUsd: usd(binding.cost) });
      await this.db.raw.prepare("UPDATE economic_managed_purchases SET remote_job_json=? WHERE usage_id=?")
        .run(JSON.stringify(binding), usage.id);
      return reservation;
    });
    if (reserved.replay) return this.replay(accountId, key, digest);
    if (!await this.purchases.claim(reserved.id, accountId)) return { status: "pending", requestId: reserved.id };
    let receipt: z.infer<typeof receiptSchema>;
    try {
      if ("kind" in request && "kind" in offer) {
        const result = await this.hub.textHub.execute(peer.workerId, request);
        const verified = browserTextResultSchema.parse(result.result);
        const cost = (verified.inputTokens + verified.tokenIds.length) * offer.costMicrounitsPerToken;
        if (cost > binding.cost || Date.now() >= binding.deadline) throw new Error("browser_inference_expired");
        receipt = receiptSchema.parse({ binding, cost, evidenceDigest: result.evidenceDigest,
          outputBase64: Buffer.from(JSON.stringify(verified)).toString("base64") });
      } else if (!("kind" in request)) {
        const result = await this.hub.executeFundedExpert(peer.workerId, { artifactId: offer.artifactId,
          rows: request.rows, hiddenSize: request.hiddenSize, activationsBase64: request.activationsBase64 });
        receipt = receiptSchema.parse({ binding, evidenceDigest: result.evidenceDigest, outputBase64: result.outputBase64 });
      } else throw new Error("browser_offer_unavailable");
      if (Date.now() >= binding.deadline) throw new Error("browser_inference_expired");
    } catch {
      // This is our own reference-checked work, not an uncertain supplier charge.
      await this.db.transaction(async () => {
        await this.purchases.release(reserved.id, accountId, true);
        await this.usage.failUsage(reserved.id, "browser_inference_failed");
      });
      return { status: "failed", requestId: reserved.id };
    }
    const receiptId = sha256CanonicalEvidence({ usageId: reserved.id, ...receipt });
    // Persist verified evidence before settlement; recovery never dispatches compute again.
    await this.purchases.recordReceipt(reserved.id, accountId, receiptId, { ...receipt, usd: usd(receipt.cost ?? binding.cost) });
    return await this.finish(reserved.id, accountId);
  }
  private async finish(id: string, accountId: string) {
    const response = await this.db.transaction(async () => {
      const row = await this.db.raw.prepare("SELECT * FROM economic_managed_purchases WHERE usage_id=? AND account_id=? AND provider=?")
        .get(id, accountId, provider);
      if (!row) throw new Error("browser_receipt_missing");
      if (row.state === "settled" && typeof row.response_json === "string") return JSON.parse(row.response_json);
      const raw = JSON.parse(String(row.pending_receipt_json));
      const receipt = receiptSchema.parse({ binding: raw.binding, evidenceDigest: raw.evidenceDigest, outputBase64: raw.outputBase64,
        ...(raw.cost === undefined ? {} : { cost: raw.cost }) });
      if (JSON.stringify(receipt.binding) !== JSON.stringify(bindingSchema.parse(JSON.parse(String(row.remote_job_json))))
        || sha256CanonicalEvidence({ usageId: id, ...receipt }) !== row.provider_receipt_id)
        throw new Error("browser_receipt_binding_invalid");
      if ((receipt.cost ?? receipt.binding.cost) > receipt.binding.cost) throw new Error("browser_receipt_cost_invalid");
      const charge = await this.purchases.settle({ id, accountId, receiptId: String(row.provider_receipt_id),
        usd: usd(receipt.cost ?? receipt.binding.cost), evidence: receipt });
      await this.db.raw.prepare(`INSERT INTO economic_browser_inference_credits
        (usage_id,worker_id,account_id,amount_microunits,receipt_digest,created_at) VALUES (?,?,?,?,?,?)`)
        .run(id, receipt.binding.workerId, receipt.binding.accountId, charge.upstreamMicrounits,
          String(row.provider_receipt_id), Date.now());
      const text = receipt.binding.kind === "text" ? browserTextResultSchema.parse(JSON.parse(Buffer.from(receipt.outputBase64, "base64").toString())) : null;
      const result = { status: "completed", requestId: id, outputBase64: receipt.outputBase64,
        ...(text ? { response: { id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: receipt.binding.model,
          choices: [{ index: 0, message: { role: "assistant", content: text.text }, finish_reason: text.finishReason }],
          usage: { prompt_tokens: text.inputTokens, completion_tokens: text.tokenIds.length, total_tokens: text.inputTokens + text.tokenIds.length } } } : {}),
        creditsMicrounits: charge.totalMicrounits, serviceFeeMicrounits: charge.serviceFeeMicrounits,
        processing: "mycellios-network" };
      await this.db.raw.prepare("UPDATE economic_managed_purchases SET response_json=? WHERE usage_id=?").run(JSON.stringify(result), id);
      await this.usage.completeUsage(id, text?.inputTokens ?? 0, text?.tokenIds.length ?? 0);
      return result;
    });
    const binding = await this.db.raw.prepare("SELECT worker_id FROM economic_browser_inference_credits WHERE usage_id=?").get(id);
    if (binding) this.hub.notifyInferenceSettled(String(binding.worker_id));
    return response;
  }
}
