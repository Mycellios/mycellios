import { randomUUID } from "node:crypto";
import type { ManagedCatalogDiscovery, ManagedModel } from "../contracts/managed-provider.js";
import { managedCharge, markedUpUnitPrice, tokenCost, usdAtoms } from "../economy/managed-pricing.js";
import { MANAGED_MODEL_PREFIX, parseManagedProviderJson, type ManagedTextRequest, type ManagedTextResult } from "./managed-openrouter.js";
import { readManagedTextStream } from "./managed-text-stream.js";

const TTL = 60_000;
const object = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("antseed_response_invalid");
  return value as Record<string, any>;
};
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9._:/-]{1,180}$/.test(value);
const units = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^\d{1,15}$/.test(value)) throw new Error("antseed_receipt_invalid");
  return BigInt(value);
};
const decimal = (value: bigint, scale: number) => {
  const text = `${value / 10n ** BigInt(scale)}.${(value % 10n ** BigInt(scale)).toString().padStart(scale, "0")}`;
  return text.replace(/\.?0+$/, "");
};
// AntSeed advertises rates as JSON numbers per million tokens. Refuse rates
// finer than the catalog's exact decimal contract instead of rounding down.
function rate(value: unknown): string {
  if (typeof value !== "string") throw new Error("antseed_price_invalid");
  const atoms = usdAtoms(value);
  if (atoms % 1_000_000n !== 0n) throw new Error("antseed_price_precision_unsupported");
  return decimal(atoms / 1_000_000n, 18);
}
interface Offer {
  public: ManagedModel; seller: string; provider: string; service: string;
  input: string; cached: string; output: string; context: number; maxOutput: number;
}
export interface AntseedTextJob {
  kind: "antseed-text-v1"; bootId: string; cursor: number; tag: string; requestId: string;
  offer: Offer; response?: Record<string, any>;
}
export type AntseedTextQuote = {
  offer: Offer; maximumUsd: string; maximumMicrounits: number; expiresAt: number;
  fundingCostBasisPoints: number; body: Record<string, unknown> & {max_tokens: number};
  billingContext: unknown;
};

/** Dedicated operator buyer sidecar. Customers never receive its identity or control secret. */
export class ManagedAntseedText {
  readonly provider = "antseed";
  private offers = new Map<string, Offer>();
  private discovered: ManagedCatalogDiscovery[] = [];
  private refreshedAt = 0;
  private refreshing: Promise<void> | null = null;
  private readonly base: string;
  constructor(private readonly secret: string, private readonly allowed: readonly string[],
    private readonly transport: typeof fetch = fetch, private readonly funding: number | null = null,
    base = "http://127.0.0.1:8377") {
    const url = new URL(base);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== "/"
      || !secret || secret.length < 24 || !allowed.length || (allowed.includes("*") && allowed.length !== 1))
      throw new Error("managed_antseed_configuration_invalid");
    this.base = url.origin;
    if (funding !== null) managedCharge("0", funding);
  }
  private async request(path: string, signal: AbortSignal, body?: unknown, headers: Record<string, string> = {}) {
    const response = await this.transport(this.base + path, { method: body === undefined ? "GET" : "POST",
      redirect: "error", signal, headers: { "x-antseed-gateway-auth": this.secret, ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("managed_upstream_unavailable"); }
    return response;
  }
  private async json(response: Response, signal: AbortSignal, maximum = 8_388_608) {
    const reader = response.body?.getReader(); if (!reader) throw new Error("antseed_response_missing");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        signal.throwIfAborted(); const item = await reader.read(); if (item.done) break;
        size += item.value.length; if (size > maximum) throw new Error("antseed_response_too_large");
        chunks.push(item.value);
      }
      return object(parseManagedProviderJson(Buffer.concat(chunks).toString("utf8"),
        ["inputUsdPerMillion", "outputUsdPerMillion", "cachedInputUsdPerMillion"]));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private async feed(after: number, signal: AbortSignal) {
    const page = await this.json(await this.request("/_antseed/attributed-spend?after=" + after, signal), signal);
    if (typeof page.bootId !== "string" || !page.bootId || !Number.isSafeInteger(page.cursor) || page.cursor < after
      || !Number.isSafeInteger(page.oldestSeq) || !Array.isArray(page.events) || page.events.length > 1000)
      throw new Error("antseed_receipt_feed_required");
    return page;
  }
  async refresh() {
    const signal = AbortSignal.timeout(12_000);
    // Authenticate the receipt path before advertising any spendable models.
    await this.feed(0, signal);
    const body = await this.json(await this.request("/v1/models?type=all", signal), signal);
    if (!Array.isArray(body.data) || body.data.length > 10000) throw new Error("antseed_catalog_invalid");
    const offers = new Map<string, Offer>(), discovered: ManagedCatalogDiscovery[] = [], seen = new Set<string>();
    for (const value of body.data) {
      try {
        const row = object(value);
        if (!id(row.id) || (!this.allowed.includes("*") && !this.allowed.includes(row.id))) continue;
        const publicId = MANAGED_MODEL_PREFIX + "antseed/" + row.id;
        if (seen.has(publicId)) {
          offers.delete(publicId); const prior = discovered.find(m => m.id === publicId);
          if (prior) { prior.available = false; prior.reason = "duplicate_model"; prior.pricing = null; }
          throw new Error("antseed_duplicate_model");
        } seen.add(publicId);
        const entry: ManagedCatalogDiscovery = { id: publicId, name: typeof row.name === "string" ? row.name.slice(0, 200) : row.id,
          inputModalities: ["text"], outputModalities: [row.type === "text" ? "text" : String(row.type)],
          available: false, reason: "modality_not_qualified", provider: "Mycellios", processing: "external", pricing: null };
        discovered.push(entry);
        if (row.type !== "text" || !Array.isArray(row.peers) || row.peers.length > 1000) continue;
        entry.reason = "pricing_not_qualified";
        const candidates: Offer[] = [];
        for (const raw of row.peers) {
          try {
            const peer = object(raw), caps = object(peer.capabilities);
            if (typeof peer.peerId !== "string" || !/^[a-f0-9]{64}$/.test(peer.peerId)
              || !id(peer.serviceId) || !id(peer.provider) || peer.type !== "text"
              || !Array.isArray(peer.protocols) || !peer.protocols.includes("openai-chat-completions")
              || peer.unitBillingModels !== undefined || peer.provider === "ant-agent"
              || !Array.isArray(caps.inputs) || !caps.inputs.includes("text")
              || !Array.isArray(caps.outputs) || caps.outputs.length !== 1 || caps.outputs[0] !== "text"
              || !Number.isSafeInteger(caps.contextWindow) || caps.contextWindow < 4608
              || !Number.isSafeInteger(caps.maxOutputTokens) || caps.maxOutputTokens < 1) continue;
            const input = rate(peer.inputUsdPerMillion), output = rate(peer.outputUsdPerMillion);
            const cached = peer.cachedInputUsdPerMillion === undefined ? input : rate(peer.cachedInputUsdPerMillion);
            const upperInput = usdAtoms(input) > usdAtoms(cached) ? input : cached;
            // A priced offer's temporary free allowance has no signed-spend
            // receipt. It needs a separate authoritative zero-cost contract.
            if (peer.freeTier !== undefined && usdAtoms(upperInput) + usdAtoms(output) > 0n) continue;
            if (usdAtoms(upperInput) + usdAtoms(output) > 0n && this.funding === null) {
              entry.reason = "funding_cost_not_configured"; continue;
            }
            const funding = this.funding ?? 0;
            candidates.push({ seller: peer.peerId, provider: peer.provider, service: peer.serviceId,
              input: upperInput, cached, output, context: caps.contextWindow, maxOutput: Math.min(8192, caps.maxOutputTokens),
              public: { id: publicId, name: entry.name, owned_by: "mycellios", processing: "external", modality: "text",
                pricing: { currency: "credits", unit: "token", serviceFeeBasisPoints: 400, fundingCostBasisPoints: funding,
                  input: markedUpUnitPrice(upperInput, funding), output: markedUpUnitPrice(output, funding), estimate: "maximum" } } });
          } catch { /* Unknown prices/capabilities cannot authorize operator spend. */ }
        }
        candidates.sort((a, b) => {
          const delta = usdAtoms(a.input) + usdAtoms(a.output) - usdAtoms(b.input) - usdAtoms(b.output);
          return delta < 0n ? -1 : delta > 0n ? 1 : `${a.seller}/${a.provider}`.localeCompare(`${b.seller}/${b.provider}`);
        });
        const selected = candidates[0];
        if (selected) { offers.set(publicId, selected); entry.available = true; entry.reason = "ready"; entry.pricing = selected.public.pricing; }
      } catch { /* Invalid catalog entries stay unavailable. */ }
    }
    this.offers = offers; this.discovered = discovered; this.refreshedAt = Date.now();
  }
  async ensureFresh() {
    if (Date.now() - this.refreshedAt < TTL) return;
    this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; }); await this.refreshing;
  }
  catalog(): ManagedModel[] { return Date.now() - this.refreshedAt < TTL ? [...this.offers.values()].map(o => o.public) : []; }
  inventory() { return this.discovered.map(row => ({ ...row, available: Date.now() - this.refreshedAt < TTL && row.available })); }
  quote(request: ManagedTextRequest): AntseedTextQuote {
    const offer = Date.now() - this.refreshedAt < TTL ? this.offers.get(request.model) : undefined;
    if (!offer) throw new Error("managed_model_unavailable");
    const allowed = new Set(["model", "messages", "max_tokens", "stream", "store", "temperature", "top_p", "stop", "tools", "tool_choice", "parallel_tool_calls", "response_format"]);
    if (Object.keys(request).some(k => !allowed.has(k)) || (request.stream !== undefined && typeof request.stream !== "boolean")
      || (request.store !== undefined && request.store !== false)) throw new Error("managed_request_unsupported");
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 256) throw new Error("managed_messages_invalid");
    for (const raw of request.messages) {
      const m = object(raw);
      if (!["system", "developer", "user", "assistant", "tool"].includes(m.role)
        || (typeof m.content !== "string" && !(m.content === null && Array.isArray(m.tool_calls)))
        || Object.keys(m).some(k => !["role", "content", "name", "tool_calls", "tool_call_id"].includes(k))) throw new Error("managed_text_only");
    }
    if (request.tools !== undefined && (!Array.isArray(request.tools) || request.tools.length > 128 || request.tools.some(raw => {
      const tool = object(raw), fn = object(tool.function); return tool.type !== "function"
        || typeof fn.name !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(fn.name);
    }))) throw new Error("managed_server_tools_not_allowed");
    const bytes = Buffer.byteLength(JSON.stringify(request)), output = request.max_tokens ?? Math.min(256, offer.maxOutput);
    if (bytes > 131072 || !Number.isSafeInteger(output) || output < 1 || output > offer.maxOutput || bytes + 4096 + output > offer.context)
      throw new Error("managed_request_too_large");
    const maximumUsd = tokenCost(offer.input, offer.output, bytes + 4096, output), fundingCostBasisPoints = this.funding ?? 0;
    return { offer, maximumUsd, maximumMicrounits: managedCharge(maximumUsd, fundingCostBasisPoints).totalMicrounits,
      fundingCostBasisPoints, expiresAt: this.refreshedAt + TTL,
      billingContext: {seller:offer.seller,provider:offer.provider,service:offer.service,input:offer.input,cached:offer.cached,output:offer.output},
      body: { ...request, model: `${offer.seller}@${offer.service}`, store: false, max_tokens: output,
        ...(request.stream ? { stream_options: { include_usage: true } } : {}) } };
  }
  async execute(q: AntseedTextQuote, chunk?: (value: Record<string, unknown>) => void,
    submitted?: (job: unknown) => Promise<void>): Promise<ManagedTextResult> {
    if (!submitted || q.expiresAt <= Date.now()) throw new Error("managed_quote_expired");
    const signal = AbortSignal.timeout(120_000), baseline = await this.feed(0, signal);
    const job: AntseedTextJob = { kind: "antseed-text-v1", bootId: baseline.bootId, cursor: baseline.cursor,
      tag: randomUUID(), requestId: randomUUID(), offer: q.offer };
    // This durable intent must succeed BEFORE a possibly billable POST.
    await submitted(job);
    const policy = { allowedPeerIds: [q.offer.seller], allowedModels: [q.offer.service],
      maxInputUsdPerMillion: Number(tokenCost(q.offer.input, "0", 1000000, 0)),
      maxOutputUsdPerMillion: Number(tokenCost("0", q.offer.output, 0, 1000000)),
      maxCachedInputUsdPerMillion: Number(tokenCost(q.offer.input, "0", 1000000, 0)), maxImageUsdPerImage: 0 };
    const response = await this.request("/v1/chat/completions", signal, q.body, {
      "x-antseed-request-id": job.requestId, "x-antseed-attribution-tag": job.tag,
      "x-antseed-provider": q.offer.provider, "x-antseed-service": q.offer.service,
      "x-antseed-routing-policy": Buffer.from(JSON.stringify(policy)).toString("base64url") });
    const value = object(q.body.stream ? await readManagedTextStream(response, signal, parseManagedProviderJson, q.offer.public.id, chunk)
      : await this.json(response, signal, 4_194_304));
    const usage = object(value.usage);
    if (typeof value.id !== "string" || !value.id || !Array.isArray(value.choices) || value.choices.length !== 1
      || ![usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("antseed_usage_missing");
    job.response = { id: value.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: q.offer.public.id,
      choices: value.choices, usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
        total_tokens: usage.prompt_tokens + usage.completion_tokens } };
    await submitted(job);
    // A late signature is recovered by GET-only reconciliation, never another inference.
    const result = await this.recover(job); if (!result) throw new Error("antseed_receipt_pending"); return result;
  }
  async recover(value: unknown): Promise<ManagedTextResult | null> {
    const job = object(value) as AntseedTextJob;
    if (job.kind !== "antseed-text-v1" || !job.response) return null;
    const signal = AbortSignal.timeout(12_000);
    let cursor = job.cursor, total = 0n, input = 0n, output = 0n;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await this.feed(cursor, signal);
      if (page.bootId !== job.bootId || page.oldestSeq > cursor + 1) throw new Error("antseed_receipt_history_lost");
      let previous = cursor;
      for (const raw of page.events) {
        const e = object(raw);
        if (!Number.isSafeInteger(e.seq) || e.seq <= previous || e.seq > page.cursor) throw new Error("antseed_receipt_sequence_invalid");
        previous = e.seq;
        if (e.tag !== job.tag) continue;
        if (e.requestId !== job.requestId || e.sellerPeerId !== job.offer.seller || e.buyerIdentity !== "default" || e.purpose
          || units(e.outputImages) !== 0n) throw new Error("antseed_receipt_mismatch");
        total += units(e.amountUsdc); input += units(e.inputTokens) + units(e.cachedInputTokens); output += units(e.outputTokens);
      }
      if (page.events.length < 1000) break;
      if (page.cursor <= cursor || pageNumber === 99) throw new Error("antseed_receipt_history_incomplete"); cursor = page.cursor;
    }
    const free = usdAtoms(job.offer.input) + usdAtoms(job.offer.output) === 0n;
    if (!free && (input !== BigInt(job.response.usage.prompt_tokens) || output !== BigInt(job.response.usage.completion_tokens)
      || total === 0n)) return null;
    return { response: job.response, receiptId: `antseed:${job.bootId}:${job.tag}`, usd: decimal(total, 6),
      inputTokens: job.response.usage.prompt_tokens, outputTokens: job.response.usage.completion_tokens };
  }
}
