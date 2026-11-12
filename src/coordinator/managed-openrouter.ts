import type { ManagedModel } from "../contracts/managed-provider.js";
import { addUsd, managedCharge, markedUpUnitPrice, tokenCost, usdAtoms } from "../economy/managed-pricing.js";
import { readManagedTextStream } from "./managed-text-stream.js";

const BASE = "https://openrouter.ai/api/v1";
export const MANAGED_MODEL_PREFIX = "mycellios/managed/";
export interface ManagedTextOffer {
  public: ManagedModel;
  upstreamId: string;
  inputUsd: string;
  outputUsd: string;
  requestUsd: string;
  contextLength: number;
}
export interface ManagedTextRequest { model: string; messages: unknown[]; max_tokens?: number; [key: string]: unknown }
export interface ManagedTextResult { response: Record<string, unknown>; receiptId: string; usd: string; inputTokens: number; outputTokens: number }

export function parseManagedProviderJson(text: string, additionalMoneyKeys: readonly string[] = []): unknown {
  const parse = JSON.parse as (text: string, reviver: (key: string, value: unknown, context?: { source?: string }) => unknown) => unknown;
  return parse(text, (key, value, context) => {
    if ((key === "cost" || key === "total_cost" || key === "cost_usd" || additionalMoneyKeys.includes(key)) && typeof value === "number") {
      if (!context?.source) throw new Error("managed_exact_money_parser_required");
      return context.source;
    }
    return value;
  });
}

async function json(response: Response, limit: number, signal: AbortSignal): Promise<unknown> {
  if (!response.ok) { await response.body?.cancel(); throw new Error("managed_upstream_unavailable"); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("managed_response_missing");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > limit) throw new Error("managed_response_too_large");
      chunks.push(item.value);
    }
    // Node 24's source context preserves exact money lexemes, including tiny decimal costs.
    return parseManagedProviderJson(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("managed_response_invalid");
  return v as Record<string, unknown>;
};
function upperTokenPrices(prices:Record<string,unknown>) {
  if(prices.overrides!==undefined&&(!Array.isArray(prices.overrides)||prices.overrides.length>100))throw new Error("managed_pricing_invalid");
  const variants=[prices,...(Array.isArray(prices.overrides)?prices.overrides.map(object):[])];
  const max=(keys:string[],base:string)=>variants.reduce((highest,row)=>keys.reduce((value,key)=>{
    if(row[key]===undefined)return value;if(typeof row[key]!=="string")throw new Error("managed_pricing_invalid");
    return usdAtoms(row[key])>usdAtoms(value)?row[key]:value;
  },highest),base);
  const known=new Set(["prompt","completion","request","web_search","image","image_token","image_output","audio","audio_output","input_audio_cache","input_cache_read","input_cache_write","input_cache_write_1h","internal_reasoning","overrides"]);
  for(const row of variants)for(const [key,value] of Object.entries(row)) {
    if(["min_prompt_tokens","max_prompt_tokens","start_time","end_time","weekdays"].includes(key))continue;
    if(!known.has(key))throw new Error("managed_price_component_unsupported");
    if(key!=="overrides"&&(typeof value!=="string"||usdAtoms(value)<0n))throw new Error("managed_pricing_invalid");
  }
  return {input:max(["prompt","input_cache_read","input_cache_write","input_cache_write_1h"],String(prices.prompt)),
    output:max(["completion","internal_reasoning"],String(prices.completion)),request:max(["request"],"0")};
}

/** Server-owned credential and bounded automatic catalog, never a BYOK fallback. */
export class ManagedOpenRouter {
  readonly provider = "openrouter";
  private offers = new Map<string, ManagedTextOffer>();
  private discovered: Array<{id:string;name:string;inputModalities:string[];outputModalities:string[];available:boolean;reason?:string}> = [];
  private refreshedAt = 0;
  private refreshPending: Promise<void> | null = null;
  constructor(private readonly key: string, private readonly allowed: readonly string[], private readonly transport: typeof fetch = fetch,
    private readonly fundingCostBasisPoints: number | null = null) {
    if (!key || !allowed.length || allowed.length > 100 || (allowed.includes("*")&&allowed.length!==1)) throw new Error("managed_configuration_invalid");
    if(fundingCostBasisPoints!==null)managedCharge("0",fundingCostBasisPoints);
  }
  async refresh(): Promise<void> {
    const signal = AbortSignal.timeout(12_000);
    const response = await this.transport(`${BASE}/models?output_modalities=all`, {
      method: "GET", redirect: "error", signal, headers: { authorization: `Bearer ${this.key}` },
    });
    const body = object(await json(response, 8_388_608, signal));
    if (!Array.isArray(body.data)||body.data.length>10000) throw new Error("managed_catalog_invalid");
    const offers = new Map<string, ManagedTextOffer>();
    const discovered: typeof this.discovered = [];
    const seen=new Set<string>();
    for (const value of body.data) {
      try {
        const row = object(value);
        if (typeof row.id !== "string" || !/^~?[A-Za-z0-9._:-]+\/[A-Za-z0-9._:/-]{1,350}$/.test(row.id)
          || (!this.allowed.includes("*")&&!this.allowed.includes(row.id))) continue;
        const architecture = object(row.architecture);
        const id = MANAGED_MODEL_PREFIX + row.id;
        if(seen.has(id)) { offers.delete(id);const previous=discovered.find(m=>m.id===id);if(previous){previous.available=false;previous.reason="duplicate_model";}throw new Error("managed_duplicate_model"); }
        seen.add(id);
        const entry={id,name:typeof row.name==="string"?row.name.slice(0,250):row.id,
          inputModalities:Array.isArray(architecture.input_modalities)?architecture.input_modalities.filter((v):v is string=>typeof v==="string").slice(0,20):["text"],
          outputModalities:Array.isArray(architecture.output_modalities)?architecture.output_modalities.filter((v):v is string=>typeof v==="string").slice(0,20):[],
          available:false,reason:"modality_not_qualified"};
        discovered.push(entry);
        if(row.id.startsWith("~")){entry.reason="latest_alias_not_pinned";continue;}
        const prices=object(row.pricing);
        if((Array.isArray(row.endpoints)&&!row.endpoints.includes("/api/v1/chat/completions"))
          || /:batch$|:online$/.test(row.id))continue;
        if (!Array.isArray(architecture.output_modalities) || !architecture.output_modalities.length
          || architecture.output_modalities.some(modality=>modality!=="text")) continue;
        entry.reason="pricing_not_qualified";
        if (typeof prices.prompt !== "string" || typeof prices.completion !== "string"
          || usdAtoms(prices.prompt) < 0n || usdAtoms(prices.completion) < 0n) continue;
        if(prices.web_search!==undefined&&(typeof prices.web_search!=="string"||usdAtoms(prices.web_search)<0n))continue;
        // Optional server tools are disabled below. Native-search-only models need their own bounded billing contract.
        if(Array.isArray(row.supported_parameters)&&row.supported_parameters.includes("web_search_options")){entry.reason="paid_search_not_qualified";continue;}
        if (!Number.isSafeInteger(row.context_length) || Number(row.context_length) <= 0) continue;
        if(Number(row.context_length)<4608){entry.reason="context_bound_not_qualified";continue;}
        const upper=upperTokenPrices(prices);
        const free=usdAtoms(upper.input)+usdAtoms(upper.output)+usdAtoms(upper.request)===0n;
        if(!free&&this.fundingCostBasisPoints===null){entry.reason="funding_cost_not_configured";continue;}
        const funding=this.fundingCostBasisPoints??0;
        entry.available=true;entry.reason="ready";
        offers.set(id, { upstreamId: row.id, inputUsd: upper.input, outputUsd: upper.output,requestUsd:upper.request,
          contextLength: Number(row.context_length), public: { id, name: typeof row.name === "string" ? row.name : row.id,
            modality: "text", owned_by: "mycellios", processing: "external",
            pricing: { currency: "credits", serviceFeeBasisPoints: 400,
              input: markedUpUnitPrice(upper.input,funding), output: markedUpUnitPrice(upper.output,funding), unit: "token",
              request:markedUpUnitPrice(upper.request,funding),fundingCostBasisPoints:funding,
              ...(upper.input!==prices.prompt||upper.output!==prices.completion?{estimate:"maximum" as const}:{}) } } });
      } catch { /* Unpriced or unsupported models are unavailable, never free. */ }
    }
    this.offers = offers; this.discovered=discovered; this.refreshedAt = Date.now();
  }
  catalog(): ManagedModel[] { return this.current() ? [...this.offers.values()].map(v => v.public) : []; }
  inventory() { return this.discovered.map(row=>({...row,provider:"Mycellios",processing:"external",available:this.current()&&this.offers.has(row.id),
    ...(!this.current()?{reason:"catalog_expired"}:{}),pricing:this.offers.get(row.id)?.public.pricing??null})); }
  async ensureFresh() {
    if (this.current()) return;
    this.refreshPending ??= this.refresh().finally(() => { this.refreshPending = null; });
    await this.refreshPending;
  }
  private current(): boolean { return Date.now() - this.refreshedAt < 300_000; }
  quote(request: ManagedTextRequest) {
    const offer = this.current() ? this.offers.get(request.model) : undefined;
    if (!offer) throw new Error("managed_model_unavailable");
    const allowed = new Set(["model", "messages", "max_tokens", "stream", "store", "temperature", "top_p", "stop", "tools", "tool_choice", "parallel_tool_calls", "response_format"]);
    if (Object.keys(request).some(k => !allowed.has(k)) || (request.stream !== undefined && typeof request.stream !== "boolean")) throw new Error("managed_request_unsupported");
    if (request.store !== undefined && request.store !== false) throw new Error("managed_storage_not_allowed");
    if(request.tools!==undefined&&(!Array.isArray(request.tools)||request.tools.length>128||request.tools.some(value=>{
      const tool=object(value),fn=object(tool.function);return tool.type!=="function"||typeof fn.name!=="string"||!/^[A-Za-z0-9_-]{1,128}$/.test(fn.name);
    })))throw new Error("managed_server_tools_not_allowed");
    if (!Array.isArray(request.messages) || !request.messages.length || request.messages.length > 256) throw new Error("managed_messages_invalid");
    for (const message of request.messages) {
      const item = object(message);
      if (!["system", "developer", "user", "assistant", "tool"].includes(String(item.role))
        || (typeof item.content !== "string" && !(item.content === null && Array.isArray(item.tool_calls))))
        throw new Error("managed_text_only");
      if (Object.keys(item).some(k => !["role", "content", "name", "tool_calls", "tool_call_id"].includes(k))) throw new Error("managed_message_unsupported");
    }
    const bytes = Buffer.byteLength(JSON.stringify(request));
    const output = request.max_tokens ?? 256;
    const input = bytes + 4096; // Byte-token upper bound plus serialization allowance, not reported usage.
    if (bytes > 131_072 || !Number.isSafeInteger(output) || output < 1 || output > 8192 || input + output > offer.contextLength)
      throw new Error("managed_request_too_large");
    const maximumUsd = addUsd(tokenCost(offer.inputUsd, offer.outputUsd, input, output),offer.requestUsd);
    const fundingCostBasisPoints=this.fundingCostBasisPoints??0;
    return { offer, maximumUsd, fundingCostBasisPoints, maximumMicrounits: managedCharge(maximumUsd,fundingCostBasisPoints).totalMicrounits,
      expiresAt: this.refreshedAt + 300_000,
      body: { ...request, model: offer.upstreamId, stream: request.stream === true, store: false, max_tokens: output,
        ...(request.stream ? { stream_options: { include_usage: true } } : {}),
        provider: { allow_fallbacks: false,require_parameters:true,max_price:{
          prompt:Number(tokenCost(offer.inputUsd,"0",1000000,0)),completion:Number(tokenCost("0",offer.outputUsd,0,1000000)),request:Number(offer.requestUsd),image:0} },
        plugins:[{id:"web",enabled:false}], usage: { include: true } } };
  }
  async execute(quote: ReturnType<ManagedOpenRouter["quote"]>, onChunk?: (value: Record<string, unknown>) => void): Promise<ManagedTextResult> {
    if (Date.now() >= quote.expiresAt) throw new Error("managed_quote_expired");
    const signal = AbortSignal.timeout(120_000);
    const response = await this.transport(`${BASE}/chat/completions`, {
      method: "POST", redirect: "error", signal,
      headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
      body: JSON.stringify(quote.body),
    });
    const result = object(quote.body.stream
      ? await readManagedTextStream(response, signal, parseManagedProviderJson, quote.offer.public.id, onChunk)
      : await json(response, 4_194_304, signal));
    const usage = object(result.usage);
    if (typeof result.id !== "string" || !result.id || typeof usage.cost !== "string"
      || ![usage.prompt_tokens, usage.completion_tokens].every(n => Number.isSafeInteger(n) && Number(n) >= 0)
      || !Array.isArray(result.choices) || !result.choices.length) throw new Error("managed_receipt_missing");
    managedCharge(usage.cost,quote.fundingCostBasisPoints);
    // Return only the compatible chat response. Private routing and provider USD costs stay server-side.
    return { response: { id: result.id, object: "chat.completion",
      created: typeof result.created === "number" ? result.created : Math.floor(Date.now() / 1000), model: quote.offer.public.id,
      choices: result.choices, usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens,
        total_tokens: Number(usage.prompt_tokens) + Number(usage.completion_tokens) } },
      receiptId: result.id, usd: usage.cost, inputTokens: Number(usage.prompt_tokens), outputTokens: Number(usage.completion_tokens) };
  }
}
