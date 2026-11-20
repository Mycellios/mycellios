import { createHash } from "node:crypto";
import type { ManagedModel } from "../contracts/managed-provider.js";
import { MANAGED_TEXT_MAX_REQUEST_BYTES } from "../contracts/managed-provider.js";
import { markedUpUnitPrice } from "../economy/managed-pricing.js";
import { MANAGED_MODEL_PREFIX } from "./managed-openrouter.js";

/**
 * Zero-priced AntSeed text offers. A free offer cannot charge the operator, so it may omit
 * declared capabilities; it still never authorizes spend. Accounts start on one stable free route
 * that spreads requests over every free model the coordinator has verified itself (older gateways
 * publish only prices and reputation), never over a hardcoded model name.
 */
export const FREE_ROUTE_ID = MANAGED_MODEL_PREFIX + "free";
export const FREE_ASSUMED_CONTEXT = 32_768;
export const FREE_ASSUMED_OUTPUT = 4_096;
/** A Mico turn carries instructions, history and tool schemas; smaller windows are never recommended. */
export const FREE_RECOMMENDED_MIN_CONTEXT = 32_768;
const FREE_OVERHEAD_TOKENS = 1_024;
/** Same published token-per-byte ratio as managedTextLimits, used here only to fit the window. */
const TOKENS_PER_BYTE = 0.28;
const EXHAUSTED_COOLDOWN_MS = 15 * 60_000;
const STAKE_COOLDOWN_MS = 24 * 3_600_000;
/** A market price from fewer paid sellers is noise, not a capability signal. */
const MIN_PAID_SELLERS = 3;
const MAX_PROBES_PER_ROUND = 8;
/** A verified route slower than this to answer the probe stays listed but leaves the free pool. */
const MAX_POOL_LATENCY_MS = 15_000;
const PROBE_PASS_TTL_MS = 2 * 3_600_000;
const PROBE_FAIL_TTL_MS = 3_600_000;

type Peer = Record<string, any>;
const finite = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
const numeric = (value: unknown) => typeof value === "number" ? value : typeof value === "string" && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;

/** Sellers that answer free requests only to buyers staked in their pool reject the operator buyer. */
export function freeOfferStakersOnly(peer: Peer) {
  return peer.freeTier?.base?.stakersOnly === true;
}

/** Declared limits when present; conservative assumptions when a free seller publishes none. */
export function freeOfferLimits(peer: Peer): { context: number; maxOutput: number } | null {
  const caps = peer.capabilities;
  if (caps === undefined || caps === null) return { context: FREE_ASSUMED_CONTEXT, maxOutput: FREE_ASSUMED_OUTPUT };
  if (typeof caps !== "object" || Array.isArray(caps) || caps.toolUse === false) return null;
  if (caps.inputs !== undefined && (!Array.isArray(caps.inputs) || !caps.inputs.includes("text"))) return null;
  if (caps.outputs !== undefined && (!Array.isArray(caps.outputs) || caps.outputs.length !== 1 || caps.outputs[0] !== "text")) return null;
  const context = Number.isSafeInteger(caps.contextWindow) ? caps.contextWindow as number : FREE_ASSUMED_CONTEXT;
  const output = Number.isSafeInteger(caps.maxOutputTokens) ? caps.maxOutputTokens as number : FREE_ASSUMED_OUTPUT;
  if (context < 4_608 || output < 1) return null;
  return { context, maxOutput: Math.min(8_192, output, context - FREE_OVERHEAD_TOKENS - 1) };
}

/** Token budget a client can plan with; the byte cap still bounds every request. */
export function freeTextLimits(context: number, maxOutput: number) {
  const input = Math.max(0, Math.min(Math.floor(MANAGED_TEXT_MAX_REQUEST_BYTES * TOKENS_PER_BYTE), context - maxOutput - FREE_OVERHEAD_TOKENS));
  return { context_length: input + maxOutput, max_input_tokens: input, max_output_tokens: maxOutput };
}

/** Byte bounds protect paid maxima; a zero-priced request only has to fit the seller's window. */
export function freeRequestFits(bytes: number, output: number, context: number) {
  return Math.ceil(bytes * TOKENS_PER_BYTE) + FREE_OVERHEAD_TOKENS + output <= context;
}

/** One market name for the same model across vendor prefixes and "-free" listings. */
export function marketModelId(id: string) {
  return id.toLowerCase().replace(/^[^/]+\//, "").replace(/[-:]free$/, "");
}

/**
 * Median paid output price per market model across the whole catalog: what buyers pay for this
 * model elsewhere, a capability proxy that older gateways expose even without reference prices.
 */
export function marketReferencePrices(models: readonly Peer[]) {
  const paid = new Map<string, number[]>();
  for (const model of models) {
    if (!model || model.type !== "text" || typeof model.id !== "string" || !Array.isArray(model.peers)) continue;
    for (const peer of model.peers) {
      const output = numeric(peer?.outputUsdPerMillion);
      if (!(output > 0) || output > 1_000_000) continue;
      const key = marketModelId(model.id);
      (paid.get(key) ?? paid.set(key, []).get(key)!).push(output);
    }
  }
  const reference = new Map<string, number>();
  for (const [key, prices] of paid) {
    if (prices.length < MIN_PAID_SELLERS) continue;
    prices.sort((a, b) => a - b);
    reference.set(key, prices[Math.floor(prices.length / 2)]!);
  }
  return reference;
}

export interface FreeOfferSignals {
  /** seller@service, the identity probes and cooldowns use. */
  key: string;
  /** Published signals allow recommending it once the coordinator's own probe passes. */
  eligible: boolean;
  reference: number; allowance: number; reputation: number;
}
/** Published facts about a free offer; absent facts neither disqualify nor promote it. */
export function freeOfferSignals(peer: Peer, model: Peer, context: number, market: ReadonlyMap<string, number>): FreeOfferSignals {
  const performance = peer.performance ?? {};
  const requests = finite(performance.requests) ?? 0;
  const success = finite(performance.successRate, 0, 1);
  const firstToken = finite(performance.firstTokenMsP50);
  const health = peer.health?.status;
  const eligible = !freeOfferStakersOnly(peer) && context >= FREE_RECOMMENDED_MIN_CONTEXT
    && (health === undefined || health === "healthy")
    && !(requests >= 10 && success !== null && success < 0.9)
    && !(firstToken !== null && firstToken > 10_000);
  return {
    key: peer.peerId + "@" + peer.serviceId, eligible,
    reference: finite(model.reference_price?.output_usd_per_million, 0, 1_000_000) ?? market.get(marketModelId(String(model.id))) ?? 0,
    allowance: finite(peer.freeTier?.base?.maxRequestsPerAddress, 0, 1_000_000_000) ?? 0,
    reputation: finite(peer.effectiveReputationScore, 0, 100) ?? 0,
  };
}

export interface FreeProbeResult { ok: boolean; latencyMs: number; at: number }
/**
 * Ordered recommendation score, or null. Only an offer whose own tool-call probe passed can be
 * recommended. Higher wins element by element: market capability, measured speed (2 s buckets),
 * per-address free allowance and seller reputation.
 */
export function freeScore(signals: FreeOfferSignals, probe: FreeProbeResult | undefined): number[] | null {
  if (!signals.eligible || !probe?.ok) return null;
  return [signals.reference, -Math.ceil(probe.latencyMs / 2_000), signals.allowance, signals.reputation];
}

export function compareFreeScores(a: readonly number[], b: readonly number[]) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const delta = (b[index] ?? 0) - (a[index] ?? 0);
    if (delta) return delta;
  }
  return 0;
}

type FreeRoute = { free?: boolean; signals?: FreeOfferSignals | null; public: ManagedModel };
/**
 * The routes behind the stable free model: every free route whose own probe passed quickly,
 * strongest first. Before any probe finishes, eligible unprobed routes stand in; a route known
 * to fail never does.
 */
export function freeRoutePool<T extends FreeRoute>(offers: Iterable<T>, probes: FreeOfferProbes): T[] {
  const free = [...offers].filter(offer => offer.free && offer.signals?.eligible);
  const passed = free.filter(offer => {
    const result = probes.result(offer.signals!.key);
    return result?.ok && result.latencyMs <= MAX_POOL_LATENCY_MS;
  });
  const pool = passed.length ? passed : free.filter(offer => !probes.result(offer.signals!.key));
  const score = (offer: T) => freeScore(offer.signals!, probes.result(offer.signals!.key)) ?? [];
  return pool.sort((a, b) => compareFreeScores(score(a), score(b)) || a.public.id.localeCompare(b.public.id));
}
/**
 * Spreads conversations over the pool. The choice depends only on the opening of the
 * conversation and each route's own model id (rendezvous hashing), so a quote and its execution
 * agree and a conversation keeps its model while that model stays in the pool: routes joining or
 * leaving move only the conversations they gain or lose, never the rest.
 */
export function pickFreeRoute<T extends { public: { id: string } }>(pool: readonly T[], request: { messages?: unknown }): T | undefined {
  const opening = JSON.stringify(Array.isArray(request.messages) ? request.messages.slice(0, 2) : []);
  let best: T | undefined, bestWeight = -1n;
  for (const route of pool) {
    const weight = createHash("sha256").update(opening).update("\0").update(route.public.id).digest().readBigUInt64BE(0);
    if (weight > bestWeight || (weight === bestWeight && best && route.public.id < best.public.id)) { best = route; bestWeight = weight; }
  }
  return best;
}
/** The stable, recommended free model. Its limits fit every route it may use. */
export function freeRouteModel(pool: readonly unknown[], fundingCostBasisPoints: number): ManagedModel | null {
  if (!pool.length) return null;
  return { id: FREE_ROUTE_ID, name: "Mycellios Free", modality: "text", owned_by: "mycellios", processing: "external",
    pricing: { currency: "credits", unit: "token", serviceFeeBasisPoints: 400, fundingCostBasisPoints,
      input: markedUpUnitPrice("0", fundingCostBasisPoints), output: markedUpUnitPrice("0", fundingCostBasisPoints), estimate: "maximum" },
    ...freeTextLimits(FREE_ASSUMED_CONTEXT, FREE_ASSUMED_OUTPUT), recommended: true };
}

/** Within one model, prefer a probed free seller, then any eligible one, then reputation. */
export function compareFreeRoutes(a: { signals?: FreeOfferSignals | null }, b: { signals?: FreeOfferSignals | null }, probes: FreeOfferProbes) {
  const rank = (s?: FreeOfferSignals | null) => !s ? [0, 0, 0]
    : [probes.result(s.key)?.ok ? 1 : 0, s.eligible ? 1 : 0, s.reputation];
  return compareFreeScores(rank(a.signals), rank(b.signals));
}

/** Other free sellers of the same model kept ready, so a refused seller is replaced at once. */
export const FREE_RESERVE_SELLERS = 2;
/** Free routes one request may try after sellers refused it before any work (exact zero cost). */
export const FREE_REFUSAL_RETRIES = 2;

/** Sellers refused before any work leave the catalog for a while; staked-only pools for a day. */
export class FreeOfferCooldown {
  private readonly until = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  block(seller: string, service: string, reason: FreeRefusal = "exhausted") {
    this.until.set(seller + "@" + service, this.now() + (reason === "stake" ? STAKE_COOLDOWN_MS : EXHAUSTED_COOLDOWN_MS));
  }
  blocked(seller: string, service: string) {
    const key = seller + "@" + service, until = this.until.get(key);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.until.delete(key);
    return false;
  }
}

export type FreeRefusal = "stake" | "exhausted";
/** Upstream 429 bodies that mean a free allowance refusal, not a transient rate limit. */
export async function freeAllowanceRefusal(response: Response): Promise<FreeRefusal | null> {
  if (response.status !== 429) return null;
  try {
    const text = (await response.text()).slice(0, 16_384);
    return /stake_required/.test(text) ? "stake" : /free_tier_exhausted/.test(text) ? "exhausted" : null;
  } catch { return null; }
}

/** A tiny tool-call request, the minimum a Mico needs from its model. */
export const FREE_PROBE_REQUEST = {
  messages: [{ role: "user", content: "What is the weather in Madrid right now? Use the tool." }],
  tools: [{ type: "function", function: { name: "get_weather", description: "Get the current weather for a city",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
  tool_choice: "auto", max_tokens: 128, stream: false, store: false,
} as const;
export function freeProbePassed(body: unknown) {
  try {
    const call = (body as any)?.choices?.[0]?.message?.tool_calls?.[0]?.function;
    return call?.name === "get_weather" && /madrid/i.test(String(JSON.parse(call.arguments)?.city ?? ""));
  } catch { return false; }
}

/**
 * The coordinator's own qualification of free routes. Probes are zero-priced, bounded to a few
 * candidates per round, single-flight and never block discovery or a customer's request.
 */
export class FreeOfferProbes {
  private readonly results = new Map<string, FreeProbeResult>();
  private running: Promise<boolean> | null = null;
  constructor(private readonly now: () => number = Date.now) {}
  result(key: string) { return this.results.get(key); }
  record(key: string, ok: boolean, latencyMs: number) { this.results.set(key, { ok, latencyMs, at: this.now() }); }
  /** The strongest eligible free routes whose last probe is missing or stale. */
  due<T extends { free?: boolean; signals?: FreeOfferSignals | null }>(routes: Iterable<T>) {
    const now = this.now();
    return [...routes].filter(route => {
      if (!route.free || !route.signals?.eligible) return false;
      const last = this.results.get(route.signals.key);
      return !last || now - last.at > (last.ok ? PROBE_PASS_TTL_MS : PROBE_FAIL_TTL_MS);
    }).sort((a, b) => compareFreeScores([a.signals!.reference, a.signals!.reputation], [b.signals!.reference, b.signals!.reputation]))
      .slice(0, MAX_PROBES_PER_ROUND);
  }
  /** Runs one round in the background; resolves true when any result changed. */
  run<T>(routes: T[], probe: (route: T) => Promise<void>) {
    if (this.running || !routes.length) return this.running ?? Promise.resolve(false);
    this.running = (async () => {
      for (const route of routes) await probe(route).catch(() => {});
      return true;
    })().finally(() => { this.running = null; });
    return this.running;
  }
}
