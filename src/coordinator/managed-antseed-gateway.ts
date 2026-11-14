import { randomUUID } from "node:crypto";
import { setTimeout as receiptDelay } from "node:timers/promises";
import type { ManagedCatalogDiscovery, ManagedModel } from "../contracts/managed-provider.js";
import { managedCharge, markedUpUnitPrice, tokenCost, usdAtoms } from "../economy/managed-pricing.js";
import { MANAGED_MODEL_PREFIX, parseManagedProviderJson, type ManagedTextRequest, type ManagedTextResult } from "./managed-openrouter.js";
import { readManagedTextStream } from "./managed-text-stream.js";

const TTL = 60_000;
const INPUT_CAP = "0.0000005", OUTPUT_CAP = "0.000001";
const object = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("antseed_gateway_response_invalid");
  return v as Record<string, any>;
};
interface Offer { public: ManagedModel; seller: string; provider: string; context: number; output: number }
export interface AntseedGatewayQuote {
  offer: Offer; body: Record<string, unknown> & {max_tokens: number}; maximumUsd: string;
  maximumMicrounits: number; fundingCostBasisPoints: number; expiresAt: number; billingContext: unknown;
}
interface Job {
  kind: "antseed-gateway-v1"; keyId: string; nonce: string; offer: Offer; tag?: string;
  response?: Record<string, any>;
}

/** Gateway API keys are not buyer control secrets. Use the key's own scoped ledger session.
 * The operator must qualify the deployed deepseek-bounded-v1 gateway price/usage guard.
 * Other models remain discovery-only until their maximum invoice is enforceable upstream. */
export class ManagedAntseedGateway {
  readonly provider = "antseed-gateway";
  private readonly base: string;
  private session: {cookie: string; keyId: string; until: number} | undefined;
  private signingIn: Promise<{cookie: string; keyId: string; until: number}> | undefined;
  private refreshedAt = 0;
  private refreshing: Promise<void> | undefined;
  private offers = new Map<string, Offer>();
  private discovered: ManagedCatalogDiscovery[] = [];
  constructor(private readonly key: string, base: string, private readonly allowed: readonly string[],
    private readonly funding: number | null = null, private readonly transport: typeof fetch = fetch,
    contract = "") {
    const url = new URL(base);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
      || url.username || url.password || url.search || url.hash || !/^antseed_[A-Za-z0-9_-]{24,200}$/.test(key)
      || !allowed.length || (allowed.includes("*") && allowed.length !== 1) || contract !== "deepseek-bounded-v1")
      throw new Error("managed_antseed_gateway_configuration_invalid");
    this.base = url.href.replace(/\/+$/, "");
    if (funding !== null) managedCharge("0", funding);
  }
  private async request(path: string, signal: AbortSignal, init: RequestInit = {}) {
    const r = await this.transport(this.base + path, {...init, signal, redirect: "error"});
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) this.session = undefined;
      await r.body?.cancel(); throw new Error("managed_upstream_unavailable");
    }
    return r;
  }
  private async json(r: Response, signal: AbortSignal, maximum = 8_388_608) {
    const reader = r.body?.getReader(); if (!reader) throw new Error("antseed_response_missing");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted(); const value = await reader.read(); if (value.done) break;
        size += value.value.length; if (size > maximum) throw new Error("antseed_response_too_large"); chunks.push(value.value);
      }
      return object(parseManagedProviderJson(Buffer.concat(chunks).toString("utf8"),
        ["inputUsdPerMillion", "cachedInputUsdPerMillion", "outputUsdPerMillion"]));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async authenticate(signal: AbortSignal) {
    if (this.session && this.session.until > Date.now()) return this.session;
    this.signingIn ??= (async () => {
      // Authentication creates a key-scoped session, never a model execution or an admin token.
      const r = await this.request("/console/api/auth/api-key", signal, {method: "POST",
        headers: {"content-type": "application/json", "x-antseed-console": "1"}, body: JSON.stringify({key: this.key})});
      const cookies = r.headers.getSetCookie().map(c => c.split(";")[0]!).filter(c => /^[A-Za-z0-9_-]+=[A-Za-z0-9_-]+$/.test(c));
      const auth = await this.json(r, signal, 65536), keyId = auth.me?.key?.id;
      if (auth.kind !== "key" || typeof keyId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(keyId) || cookies.length !== 1)
        throw new Error("antseed_scoped_receipts_required");
      return this.session = {cookie: cookies[0]!, keyId, until: Date.now() + 300_000};
    })().finally(() => {this.signingIn = undefined;});
    return this.signingIn;
  }
  private async receipts(nonce: string, signal: AbortSignal) {
    const auth = await this.authenticate(signal);
    const result = await this.json(await this.request("/console/api/requests?q=" + encodeURIComponent(nonce) + "&limit=2",
      signal, {headers: {cookie: auth.cookie}}), signal, 65536);
    if (!Array.isArray(result.requests) || result.requests.length > 2 || result.nextBefore)
      throw new Error("antseed_receipts_ambiguous");
    return {keyId: auth.keyId, requests: result.requests};
  }
  async refresh() {
    const signal = AbortSignal.timeout(12_000);
    await this.receipts("mycellios-preflight-" + randomUUID(), signal);
    const data = await this.json(await this.request("/v1/models", signal, {headers: {authorization: "Bearer " + this.key}}), signal);
    if (!Array.isArray(data.data) || data.data.length > 10000) throw new Error("antseed_catalog_invalid");
    const offers = new Map<string, Offer>(), discovered: ManagedCatalogDiscovery[] = [], seen = new Set<string>();
    for (const raw of data.data) {
      try {
        const row = object(raw);
        if (typeof row.id !== "string" || !/^[A-Za-z0-9._:/-]{1,180}$/.test(row.id)
          || (!this.allowed.includes("*") && !this.allowed.includes(row.id))) continue;
        const publicId = MANAGED_MODEL_PREFIX + "antseed/" + row.id;
        if (seen.has(publicId)) {
          offers.delete(publicId); const prior = discovered.find(r => r.id === publicId);
          if (prior) {prior.available = false; prior.reason = "duplicate_model"; prior.pricing = null;} continue;
        }
        seen.add(publicId);
        const entry: ManagedCatalogDiscovery = {id: publicId, name: typeof row.name === "string" ? row.name.slice(0, 200) : row.id,
          inputModalities: ["text"], outputModalities: [typeof row.type === "string" ? row.type : "unknown"],
          available: false, reason: "cost_contract_not_qualified", provider: "Mycellios", processing: "external", pricing: null};
        discovered.push(entry);
        // This deployment enforces these caps ONLY for the exact text DeepSeek route.
        if (row.id !== "deepseek-v4-flash" || row.type !== "text" || !Array.isArray(row.peers) || row.peers.length > 1000) continue;
        if (this.funding === null) {entry.reason = "funding_cost_not_configured"; continue;}
        const candidates: (Offer & {quality: number})[] = [];
        for (const rawPeer of row.peers) {
          try {
            const p = object(rawPeer), caps = object(p.capabilities);
            if (typeof p.peerId !== "string" || !/^[a-f0-9]{40}$/.test(p.peerId) || p.serviceId !== row.id
              || p.provider !== "openai" || p.type !== "text" || p.unitBillingModels !== undefined
              || !Array.isArray(p.protocols) || !p.protocols.includes("openai-chat-completions")
              || !Array.isArray(caps.inputs) || caps.inputs.length !== 1 || caps.inputs[0] !== "text"
              || !Array.isArray(caps.outputs) || caps.outputs.length !== 1 || caps.outputs[0] !== "text"
              || !Number.isSafeInteger(caps.contextWindow) || caps.contextWindow < 16384
              || !Number.isSafeInteger(caps.maxOutputTokens) || caps.maxOutputTokens < 1) continue;
            for (const [value, maximum] of [[p.inputUsdPerMillion, "0.5"], [p.cachedInputUsdPerMillion ?? p.inputUsdPerMillion, "0.5"], [p.outputUsdPerMillion, "1"]]) {
              if (typeof value !== "string" || usdAtoms(value) > usdAtoms(maximum)) throw new Error("antseed_price_invalid");
            }
            // Rank only already-qualified offers. Effective reputation includes the
            // gateway's availability penalties; an arbitrary peer id says nothing
            // about its ability to answer. Missing/invalid scores carry no trust.
            const score = p.effectiveReputationScore;
            const quality = typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 100 ? score : 0;
            candidates.push({quality, seller: p.peerId, provider: p.provider, context: caps.contextWindow, output: Math.min(8192, caps.maxOutputTokens),
              public: {id: publicId, name: entry.name, owned_by: "mycellios", processing: "external", modality: "text",
                pricing: {currency: "credits", unit: "token", serviceFeeBasisPoints: 400, fundingCostBasisPoints: this.funding,
                  input: markedUpUnitPrice(INPUT_CAP, this.funding), output: markedUpUnitPrice(OUTPUT_CAP, this.funding), estimate: "maximum"}}});
          } catch { /* Unpriced or unsupported offers cannot spend platform funds. */ }
        }
        candidates.sort((a, b) => b.quality - a.quality || a.seller.localeCompare(b.seller));
        if (candidates[0]) {
          const {quality: _quality, ...offer} = candidates[0];
          offers.set(publicId, offer); entry.available = true; entry.reason = "ready"; entry.pricing = offer.public.pricing;
        }
      } catch { /* Invalid discovery entries cannot authorize spend. */ }
    }
    this.offers = offers; this.discovered = discovered; this.refreshedAt = Date.now();
  }
  async ensureFresh() {
    if (Date.now() - this.refreshedAt < TTL) return;
    this.refreshing ??= this.refresh().finally(() => {this.refreshing = undefined;}); await this.refreshing;
  }
  catalog(): ManagedModel[] {return Date.now() - this.refreshedAt < TTL ? [...this.offers.values()].map(o => o.public) : [];}
  inventory() {return this.discovered.map(row => ({...row, available: Date.now() - this.refreshedAt < TTL && row.available}));}
  quote(request: ManagedTextRequest): AntseedGatewayQuote {
    const offer = Date.now() - this.refreshedAt < TTL ? this.offers.get(request.model) : undefined;
    if (!offer || this.funding === null) throw new Error("managed_model_unavailable");
    const fields = new Set(["model", "messages", "max_tokens", "stream", "store", "temperature", "top_p", "stop", "tools", "tool_choice", "parallel_tool_calls", "response_format"]);
    if (Object.keys(request).some(k => !fields.has(k)) || (request.stream !== undefined && typeof request.stream !== "boolean")
      || (request.store !== undefined && request.store !== false)) throw new Error("managed_request_unsupported");
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 256) throw new Error("managed_messages_invalid");
    for (const value of request.messages) {
      const m = object(value);
      if (!["system", "developer", "user", "assistant", "tool"].includes(m.role)
        || (typeof m.content !== "string" && !(m.content === null && Array.isArray(m.tool_calls)))
        || Object.keys(m).some(k => !["role", "content", "name", "tool_calls", "tool_call_id"].includes(k))) throw new Error("managed_text_only");
    }
    if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 128 || request.tools.some(raw => {
      const t = object(raw), fn = object(t.function); return t.type !== "function" || typeof fn.name !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(fn.name);
    }))) throw new Error("managed_server_tools_not_allowed");
    const output = request.max_tokens ?? Math.min(256, offer.output);
    if (!Number.isSafeInteger(output) || output < 1 || output > offer.output) throw new Error("managed_request_too_large");
    const body = {...request, model: offer.seller + "@deepseek-v4-flash", store: false, max_tokens: output,
      ...(request.stream ? {stream_options: {include_usage: true}} : {})};
    const bytes = Buffer.byteLength(JSON.stringify(body)), inputBound = bytes + 8192 + request.messages.length * 64;
    if (bytes > 131072 || inputBound + output > offer.context) throw new Error("managed_request_too_large");
    // The gateway rounds its own upper bound to USDC micro-units. Cover that ceil as well.
    const rawUsd = tokenCost(INPUT_CAP, OUTPUT_CAP, inputBound, output);
    const micro = managedCharge(rawUsd, 0).upstreamMicrounits;
    const maximumUsd = tokenCost("0.000001", "0", micro, 0);
    return {offer, body, maximumUsd, maximumMicrounits: managedCharge(maximumUsd, this.funding).totalMicrounits,
      fundingCostBasisPoints: this.funding, expiresAt: this.refreshedAt + TTL,
      billingContext: {contract: "deepseek-bounded-v1", seller: offer.seller, provider: offer.provider,
        input: INPUT_CAP, output: OUTPUT_CAP, keyId: this.session?.keyId}};
  }
  async execute(q: AntseedGatewayQuote, chunk?: (v: Record<string, unknown>) => void, submitted?: (job: unknown) => Promise<void>): Promise<ManagedTextResult> {
    if (!submitted || q.expiresAt <= Date.now()) throw new Error("managed_quote_expired");
    const signal = AbortSignal.timeout(120_000), auth = await this.authenticate(signal);
    if ((q.billingContext as any).keyId !== auth.keyId) throw new Error("antseed_payer_changed");
    const job: Job = {kind: "antseed-gateway-v1", keyId: auth.keyId, nonce: "mycellios-" + randomUUID(), offer: q.offer};
    await submitted(job); // Durable intent before the single potentially billable POST.
    const r = await this.request("/v1/chat/completions", signal, {method: "POST",
      headers: {authorization: "Bearer " + this.key, "content-type": "application/json", "x-antseed-end-user": job.nonce,
        "x-antseed-provider": q.offer.provider}, body: JSON.stringify(q.body)});
    const tag = r.headers.get("x-antseed-gateway-tag"), seller = r.headers.get("x-antseed-peer-id");
    if ((tag !== null && !/^gw_[a-f0-9-]{36}$/.test(tag)) || seller !== q.offer.seller) {await r.body?.cancel(); throw new Error("antseed_attribution_missing");}
    // Gateway 0.1.196 forwards the seller header but omits its own request tag.
    // Its authenticated key-scoped ledger still binds our durable unique nonce.
    // Preserve the answer; billing below must resolve exactly one matching tag.
    if (tag !== null) {job.tag = tag; await submitted(job);}
    const value = object(q.body.stream ? await readManagedTextStream(r, signal, parseManagedProviderJson, q.offer.public.id, chunk, true) : await this.json(r, signal, 4_194_304));
    const usage = object(value.usage);
    if (typeof value.id !== "string" || !value.id || !Array.isArray(value.choices) || value.choices.length !== 1
      || ![usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0)
      || usage.completion_tokens > q.body.max_tokens) throw new Error("antseed_usage_missing");
    job.response = {id: value.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: q.offer.public.id,
      choices: value.choices, usage: {prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
        total_tokens: usage.prompt_tokens + usage.completion_tokens}};
    await submitted(job);
    // The signed spend feed may follow the final token frame. Wait briefly using
    // receipt GETs only, under the same execution deadline; never repeat the POST.
    for (const delay of [0, 100, 200, 400, 800]) {
      if (delay) await receiptDelay(delay, undefined, {signal});
      const result = await this.recover(job, signal); if (result) return result;
    }
    throw new Error("antseed_receipt_pending");
  }
  async recover(value: unknown, signal = AbortSignal.timeout(12_000)): Promise<ManagedTextResult | null> {
    const job = object(value) as Job;
    if (job.kind !== "antseed-gateway-v1" || !job.response) return null;
    if (!/^mycellios-[a-f0-9-]{36}$/.test(job.nonce)) throw new Error("antseed_job_invalid");
    const rows = await this.receipts(job.nonce, signal);
    if (rows.keyId !== job.keyId) throw new Error("antseed_payer_changed");
    const matches = rows.requests.filter(v => object(v).endUser === job.nonce);
    if (!matches.length) return null;
    if (matches.length !== 1) throw new Error("antseed_receipts_ambiguous");
    const row = object(matches[0]);
    if (row.keyId !== job.keyId || typeof row.tag !== "string" || !/^gw_[a-f0-9-]{36}$/.test(row.tag)
      || (job.tag !== undefined && row.tag !== job.tag) || row.sellerPeerId !== job.offer.seller
      || row.model !== "deepseek-v4-flash" || row.method !== "POST" || row.path !== "/v1/chat/completions") throw new Error("antseed_receipt_mismatch");
    if (row.costPending || !row.finishedAt || row.status !== 200 || row.spent === null) return null;
    const prompt = job.response.usage.prompt_tokens, output = job.response.usage.completion_tokens;
    const counts = [row.inputTokens, row.cachedInputTokens, row.outputTokens];
    if (!counts.every(n => Number.isSafeInteger(n) && n >= 0) || row.inputTokens + row.cachedInputTokens !== prompt || row.outputTokens !== output) return null;
    if (typeof row.spent !== "string") throw new Error("antseed_receipt_invalid");
    const cost = usdAtoms(row.spent);
    if (cost === 0n && row.servedFree !== true) return null;
    // The gateway's costPending flag alone is insufficient: require the complete signed token coverage above.
    return {response: job.response, receiptId: "antseed-gateway:" + job.keyId + ":" + row.tag,
      usd: row.spent, inputTokens: prompt, outputTokens: output};
  }
}
