import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { ManagedAntseedText } from "../src/coordinator/managed-antseed-text.js";
import { ManagedAntseedGateway } from "../src/coordinator/managed-antseed-gateway.js";
import { handleManagedChat } from "../src/coordinator/managed-provider-routes.js";
import { readManagedProviderConfig } from "../src/core/managed-provider-config.js";
import { FREE_ROUTE_ID, FreeOfferCooldown, FreeOfferProbes, freeOfferSignals, freeRoutePool, freeScore, freeTextLimits,
  marketReferencePrices, pickFreeRoute } from "../src/coordinator/managed-free-offers.js";
import type { ManagedModel } from "../src/contracts/managed-provider.js";
import { operatorSecret } from "./fixtures/managed-antseed.js";
import { gatewayKey } from "./fixtures/managed-antseed-gateway.js";

// Synthetic offers shaped like the public AntSeed catalog. No network, keys or money.
const forge = "1".repeat(40), staked = "2".repeat(40), small = "3".repeat(40), paid = "4".repeat(40), meteor = "5".repeat(40);
const peer = (peerId: string, serviceId: string, extra: Record<string, unknown> = {}) => ({
  peerId, provider: "openai", serviceId, type: "text", protocols: ["openai-chat-completions"],
  inputUsdPerMillion: 0, cachedInputUsdPerMillion: 0, outputUsdPerMillion: 0, effectiveReputationScore: 91, ...extra,
});
const caps = { capabilities: { inputs: ["text"], outputs: ["text"], contextWindow: 131072, maxOutputTokens: 8192, toolUse: true } };
const priced = (peerId: string, serviceId: string, output: number) => peer(peerId, serviceId, { inputUsdPerMillion: 1, cachedInputUsdPerMillion: 1, outputUsdPerMillion: output, ...caps });
function network() {
  return [
    // Published signals (newer buyers): reliable, fast, no declared capabilities.
    { id: "glm-flash", name: "GLM Flash", type: "text", reference_price: { input_usd_per_million: 0.15, output_usd_per_million: 0.5 },
      peers: [peer(forge, "glm-flash", { health: { status: "healthy" }, freeTier: { base: { maxRequestsPerAddress: 500 } },
        performance: { requests: 99, successRate: 1, firstTokenMsP50: 1467, tokensPerSecondP50: 164 } })] },
    // Frequent measured failures on the open seller; a staked-only pool on the other.
    { id: "deepseek-flash", name: "DeepSeek Flash", type: "text",
      peers: [peer(forge, "deepseek-flash", { performance: { requests: 284, successRate: 0.75 } }),
        peer(staked, "deepseek-flash", { freeTier: { base: { stakersOnly: true } }, ...caps })] },
    // A 16k window is too small to recommend for a Mico turn.
    { id: "oss-small", name: "OSS Small", type: "text",
      peers: [peer(small, "oss-small", { capabilities: { contextWindow: 16000, maxOutputTokens: 2048, toolUse: true } })] },
    // Older gateways publish only prices: the market of paid sellers says it is strong, but its
    // free seller answers in prose instead of calling the tool.
    { id: "rival-free", name: "Rival", type: "text",
      peers: [peer(meteor, "rival-free"), priced(paid, "rival", 3), priced("6".repeat(40), "rival", 3), priced("7".repeat(40), "rival", 3)] },
    // Older gateways do not mark staked-only pools; the seller says so when probed.
    { id: "staked-old", name: "Staked", type: "text",
      peers: [peer(staked, "staked-old"), priced(paid, "staked-old", 5), priced("6".repeat(40), "staked-old", 5), priced("7".repeat(40), "staked-old", 5)] },
    { id: "no-tools", name: "No tools", type: "text", peers: [peer(forge, "no-tools", { capabilities: { toolUse: false } })] },
    { id: "paid-model", name: "Paid", type: "text", peers: [priced(paid, "paid-model", 2)] },
  ];
}
const toolCall = () => Response.json({ id: "probe", choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
  tool_calls: [{ id: "c1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Madrid\"}" } }] } }],
  usage: { prompt_tokens: 80, completion_tokens: 12 } });
const prose = () => Response.json({ id: "probe", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "It is sunny." } }],
  usage: { prompt_tokens: 80, completion_tokens: 5 } });
const refusal = (code: string) => Response.json({ error: { code, message: "Free allowance unavailable" } }, { status: 429 });
/** Answers like the sellers above: glm calls tools, rival writes prose, the staked pool refuses. */
function seller(model: string, exhausted: boolean) {
  if (exhausted) return refusal("free_tier_exhausted");
  if (model.endsWith("@staked-old")) return refusal("stake_required");
  if (model.endsWith("@rival-free")) return prose();
  return toolCall();
}
const chat = (input: string) => ({ model: "mycellios/managed/antseed/" + input, messages: [{ role: "user", content: "Hello" }], max_tokens: 64 });
const ids = (models: { id: string }[]) => models.filter(m => m.id !== FREE_ROUTE_ID).map(m => m.id.replace("mycellios/managed/antseed/", "")).sort();
const recommended = (models: { id: string; recommended?: true }[]) => models.filter(m => m.recommended).map(m => m.id);
const free = { model: FREE_ROUTE_ID, messages: [{ role: "user", content: "Hello" }], max_tokens: 64 };
/** The concrete route the stable free model resolves to, once its probes have run. */
const freeRoute = (adapter: { quote(r: never): { body: Record<string, unknown> } }) => String(adapter.quote(free as never).body.model);

function sidecar(options: { oldListing?: boolean } = {}) {
  let exhausted = false; const listings: string[] = [], posts: string[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/_antseed/attributed-spend") return Response.json({ bootId: "boot", cursor: 0, oldestSeq: 1, events: [] });
    if (u.pathname === "/v1/models") {
      listings.push(u.search);
      if (options.oldListing && u.searchParams.get("type") === "text") return new Response(null, { status: 400 });
      return Response.json({ data: network() });
    }
    if (u.pathname !== "/v1/chat/completions" || init?.method !== "POST") throw new Error("unexpected fixture route");
    const body = JSON.parse(String(init.body)); posts.push(body.model);
    return seller(body.model, exhausted);
  });
  return { adapter: new ManagedAntseedText(operatorSecret, ["*"], transport), listings, posts, exhaust: () => { exhausted = true; } };
}
function gateway() {
  let exhausted = false; const posts: Record<string, any>[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/console/api/auth/api-key")
      return Response.json({ kind: "key", me: { key: { id: "key-fixture" } } }, { headers: { "set-cookie": "antseed_session=fixture; Path=/console" } });
    if (u.pathname === "/console/api/requests") return Response.json({ requests: [], nextBefore: null });
    if (u.pathname === "/v1/models") return Response.json({ data: network() }, { headers: { "x-mycellios-cost-contract": "token-bounded-v2" } });
    if (u.pathname !== "/v1/chat/completions" || init?.method !== "POST") throw new Error("unexpected fixture route");
    const body = JSON.parse(String(init.body)); posts.push(body);
    return seller(body.model, exhausted);
  });
  const adapter = new ManagedAntseedGateway(gatewayKey, "http://127.0.0.1:8379", ["*"], 2, transport, "token-bounded-v2");
  return { adapter, posts, exhaust: () => { exhausted = true; } };
}

/** A buyer whose listed free sellers each answer, or refuse once added to `refused`. */
function refusingSidecar(data: unknown[]) {
  const refused = new Set<string>(), probes: string[] = [], chats: string[] = [];
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/_antseed/attributed-spend") return Response.json({ bootId: "boot", cursor: 0, oldestSeq: 1, events: [] });
    if (u.pathname === "/v1/models") return Response.json({ data });
    if (u.pathname !== "/v1/chat/completions" || init?.method !== "POST") throw new Error("unexpected fixture route");
    const body = JSON.parse(String(init.body)), seller = String(body.model).split("@")[0]!;
    (body.tools ? probes : chats).push(seller);
    if (refused.has(seller)) return refusal("free_tier_exhausted");
    return body.tools ? toolCall() : Response.json({ id: "chat", choices: [{ index: 0, finish_reason: "stop",
      message: { role: "assistant", content: "Hi" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
  });
  return { adapter: new ManagedAntseedText(operatorSecret, ["*"], transport, 0), refused, probes, chats };
}

/** The gateway-key equivalent: free sellers answer with their own signed zero-cost ledger row. */
function refusingGateway(data: unknown[]) {
  const refused = new Set<string>(), chats: string[] = [], rows = new Map<string, Record<string, unknown>>();
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    const u = new URL(String(url));
    if (u.pathname === "/console/api/auth/api-key")
      return Response.json({ kind: "key", me: { key: { id: "key-fixture" } } }, { headers: { "set-cookie": "antseed_session=fixture; Path=/console" } });
    if (u.pathname === "/console/api/requests") {
      const row = rows.get(u.searchParams.get("q") ?? "");
      return Response.json({ requests: row ? [row] : [], nextBefore: null });
    }
    if (u.pathname === "/v1/models") return Response.json({ data }, { headers: { "x-mycellios-cost-contract": "token-bounded-v2" } });
    if (u.pathname !== "/v1/chat/completions" || init?.method !== "POST") throw new Error("unexpected fixture route");
    const body = JSON.parse(String(init.body)), [seller, service] = String(body.model).split("@") as [string, string];
    if (!body.tools) chats.push(seller);
    if (refused.has(seller)) return refusal("free_tier_exhausted");
    if (body.tools) return toolCall();
    const nonce = new Headers(init.headers).get("x-antseed-end-user")!, tag = "gw_" + randomUUID();
    rows.set(nonce, { tag, keyId: "key-fixture", endUser: nonce, model: service, sellerPeerId: seller, method: "POST",
      path: "/v1/chat/completions", finishedAt: Date.now(), status: 200, inputTokens: 3, cachedInputTokens: 0, outputTokens: 2,
      spent: "0", servedFree: true });
    return Response.json({ id: "chat", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Hi" } }],
      usage: { prompt_tokens: 3, completion_tokens: 2 } }, { headers: { "x-antseed-peer-id": seller, "x-antseed-gateway-tag": tag } });
  });
  return { adapter: new ManagedAntseedGateway(gatewayKey, "http://127.0.0.1:8379", ["*"], 2, transport, "token-bounded-v2"), refused, chats };
}

describe("free AntSeed offers", () => {
  it("serves a refused free request on a reserve seller of the same model, never on its paid seller", async () => {
    const other = "8".repeat(40), glm = network()[0]!;
    const { adapter, refused, probes, chats } = refusingSidecar([{ ...glm, peers: [...glm.peers,
      peer(other, "glm-flash", { health: { status: "healthy" } }), priced(paid, "glm-flash", 2)] }]);
    await adapter.refresh();
    await vi.waitFor(() => expect(probes).toEqual([forge]));
    expect(adapter.quote(chat("glm-flash")).body.model).toBe(forge + "@glm-flash");
    refused.add(forge);
    expect((await adapter.execute(adapter.quote(chat("glm-flash")), undefined, async () => {})).usd).toBe("0");
    expect(chats).toEqual([forge, other]);
    // The reserve now serves the model, and it is probed in turn.
    expect(adapter.quote(chat("glm-flash")).body.model).toBe(other + "@glm-flash");
    await vi.waitFor(() => expect(probes).toEqual([forge, other]));
    // With every free seller refusing, the request fails instead of moving to the paid seller.
    refused.add(other);
    await expect(adapter.execute(adapter.quote(chat("glm-flash")), undefined, async () => {})).rejects.toThrow("managed_free_tier_exhausted");
    expect(chats).toEqual([forge, other, other]);
    expect(() => adapter.quote(chat("glm-flash"))).toThrow("managed_model_unavailable");
  });

  it("serves a refused request on a reserve free seller through a bounded gateway key as well", async () => {
    const other = "8".repeat(40), glm = network()[0]!;
    const { adapter, refused, chats } = refusingGateway([{ ...glm, peers: [...glm.peers, peer(other, "glm-flash", { health: { status: "healthy" } })] }]);
    await adapter.refresh();
    expect(adapter.quote(chat("glm-flash")).body.model).toBe(forge + "@glm-flash");
    refused.add(forge);
    expect((await adapter.execute(adapter.quote(chat("glm-flash")), undefined, async () => {})).usd).toBe("0");
    expect(chats).toEqual([forge, other]);
    expect(adapter.quote(chat("glm-flash")).body).toMatchObject({ model: other + "@glm-flash", mycellios_cost_bounds: { input: "0", output: "0" } });
  });

  it("moves a refused free-model request to another verified free route within the same request", async () => {
    const other = "8".repeat(40), [glm] = network();
    const { adapter, refused, probes, chats } = refusingSidecar([glm, { id: "qwen-free", name: "Qwen", type: "text",
      peers: [peer(other, "qwen-free", { health: { status: "healthy" } })] }]);
    await adapter.refresh();
    await vi.waitFor(() => expect(probes.sort()).toEqual([forge, other].sort()));
    const first = String(adapter.quote(free as never).body.model).split("@")[0]!;
    refused.add(first);
    const result = await adapter.execute(adapter.quote(free as never), undefined, async () => {});
    expect(result.usd).toBe("0");
    expect(chats).toEqual([first, first === forge ? other : forge]);
    // At most FREE_REFUSAL_RETRIES further routes: a request never loops over the whole pool.
    refused.add(forge); refused.add(other);
    await expect(adapter.execute(adapter.quote(free as never), undefined, async () => {})).rejects.toThrow();
    expect(chats).toHaveLength(3);
  });

  it("derives a market capability price only from several paid sellers", () => {
    const market = marketReferencePrices([...network(), { id: "solo", type: "text", peers: [priced(paid, "solo", 9)] }]);
    expect(market.get("rival")).toBe(3);
    expect(market.get("staked-old")).toBe(5);
    expect(market.has("solo")).toBe(false);
    expect(market.has("paid-model")).toBe(false);
  });

  it("recommends only routes that passed the coordinator's own tool-call probe", () => {
    const [glm, deepseek, small] = network();
    const signals = freeOfferSignals(glm!.peers[0]!, glm!, 32_768, new Map());
    expect(signals).toMatchObject({ eligible: true, reference: 0.5, allowance: 500, reputation: 91 });
    expect(freeScore(signals, undefined)).toBeNull();
    expect(freeScore(signals, { ok: false, latencyMs: 900, at: 0 })).toBeNull();
    expect(freeScore(signals, { ok: true, latencyMs: 2_500, at: 0 })).toEqual([0.5, -2, 500, 91]);
    expect(freeOfferSignals(deepseek!.peers[0]!, deepseek!, 32_768, new Map()).eligible).toBe(false); // 75 % success
    expect(freeOfferSignals(deepseek!.peers[1]!, deepseek!, 131_072, new Map()).eligible).toBe(false); // stakers only
    expect(freeOfferSignals(small!.peers[0]!, small!, 16_000, new Map()).eligible).toBe(false); // too small
    expect(freeTextLimits(32_768, 4_096)).toEqual({ context_length: 31_744, max_input_tokens: 27_648, max_output_tokens: 4_096 });
  });

  it("lists free routes without funding or declared capabilities and routes the free model to the one that calls tools", async () => {
    const { adapter, listings, posts } = sidecar();
    await adapter.refresh();
    expect(ids(adapter.catalog())).toEqual(["deepseek-flash", "glm-flash", "oss-small", "rival-free", "staked-old"]);
    // Only the stable free model is recommended, and it is available before probes finish.
    expect(recommended(adapter.catalog())).toEqual([FREE_ROUTE_ID]);
    expect(adapter.catalog().find(m => m.id === FREE_ROUTE_ID)).toMatchObject({ name: "Mycellios Free", pricing: { input: "0", output: "0" } });
    await vi.waitFor(() => expect(posts).toHaveLength(3));
    await vi.waitFor(() => expect(freeRoute(adapter)).toBe(forge + "@glm-flash"));
    // Probes go to the strongest eligible routes only, strongest market first, each once.
    expect(posts).toEqual([staked + "@staked-old", meteor + "@rival-free", forge + "@glm-flash"]);
    // The staked pool rests for a day; the prose seller rests until another seller can be tried.
    expect(ids(adapter.catalog())).toEqual(["deepseek-flash", "glm-flash", "oss-small"]);
    expect(adapter.catalog().find(m => m.id.endsWith("glm-flash"))).toMatchObject({ pricing: { input: "0", output: "0" }, max_input_tokens: 27_648 });
    expect(adapter.quote(chat("glm-flash"))).toMatchObject({ maximumUsd: "0", maximumMicrounits: 0 });
    expect(adapter.quote(chat("deepseek-flash")).body.model).toBe(forge + "@deepseek-flash"); // never the staked pool
    expect(listings[0]).toBe("?type=text");
    await adapter.refresh();
    expect(freeRoute(adapter)).toBe(forge + "@glm-flash");
    expect(posts).toHaveLength(3); // fresh results are reused
  });

  it("fits a free request by its own window, not by the paid byte bound", async () => {
    const { adapter } = sidecar(); await adapter.refresh();
    const fits = { ...chat("glm-flash"), messages: [{ role: "user", content: "a".repeat(60_000) }] };
    const larger = { ...chat("glm-flash"), messages: [{ role: "user", content: "a".repeat(120_000) }] };
    expect(adapter.quote(fits).maximumUsd).toBe("0");
    expect(() => adapter.quote(larger)).toThrow("managed_request_too_large");
  });

  it("rests a seller whose free allowance is exhausted and takes it out of the free model", async () => {
    const { adapter, posts, exhaust } = sidecar(); await adapter.refresh();
    await vi.waitFor(() => expect(posts).toHaveLength(3));
    await vi.waitFor(() => expect(freeRoute(adapter)).toBe(forge + "@glm-flash"));
    exhaust();
    await expect(adapter.execute(adapter.quote(free as never), undefined, async () => {})).rejects.toThrow("managed_free_tier_exhausted");
    expect(ids(adapter.catalog())).not.toContain("glm-flash");
    await adapter.refresh();
    expect(ids(adapter.catalog())).not.toContain("glm-flash");
    // No other verified or untried free route remains: the free model is honestly unavailable.
    expect(adapter.catalog().some(m => m.id === FREE_ROUTE_ID)).toBe(false);
    expect(() => adapter.quote(free as never)).toThrow("managed_model_unavailable");
  });

  it("spreads conversations over every verified free route and keeps each conversation on its route", () => {
    let now = 0; const probes = new FreeOfferProbes(() => now);
    const route = (id: string, reference: number, latencyMs: number) => {
      const key = id + "@svc"; probes.record(key, true, latencyMs);
      return { free: true, signals: { key, eligible: true, reference, allowance: 0, reputation: 50 }, public: { id } as ManagedModel };
    };
    const slow = route("slow", 9, 33_000), failed = { ...route("failed", 8, 100) };
    probes.record("failed@svc", false, 100);
    const pool = freeRoutePool([route("a", 3, 900), route("b", 1, 1_200), route("c", 2, 5_000), slow, failed], probes);
    expect(pool.map(r => r.public.id)).toEqual(["a", "c", "b"]); // strongest first; slow and failed stay out
    const opening = (n: number) => ({ messages: [{ role: "system", content: "Mico" }, { role: "user", content: "Conversation " + n }] });
    const used = new Set(Array.from({ length: 30 }, (_, n) => pickFreeRoute(pool, opening(n))!.public.id));
    expect([...used].sort()).toEqual(["a", "b", "c"]);
    const later = { messages: [...opening(4).messages, { role: "assistant", content: "Hi" }, { role: "user", content: "More" }] };
    expect(pickFreeRoute(pool, later)).toBe(pickFreeRoute(pool, opening(4)));
    // When a route leaves the pool its conversations move to the remaining ones.
    expect(pool.slice(1)).toContain(pickFreeRoute(pool.slice(1), opening(4)));
    // Only the conversations of a route that leaves move; a joining route takes some and moves no others.
    const before = Array.from({ length: 60 }, (_, n) => pickFreeRoute(pool, opening(n))!.public.id);
    const smaller = pool.filter(r => r.public.id !== "b");
    Array.from({ length: 60 }, (_, n) => pickFreeRoute(smaller, opening(n))!.public.id)
      .forEach((id, n) => { if (before[n] !== "b") expect(id).toBe(before[n]); });
    const larger = [...pool, route("d", 1, 900)];
    Array.from({ length: 60 }, (_, n) => pickFreeRoute(larger, opening(n))!.public.id)
      .forEach((id, n) => { if (id !== "d") expect(id).toBe(before[n]); });
  });

  it("reads older buyers that only list the combined catalog", async () => {
    const { adapter, listings } = sidecar({ oldListing: true }); await adapter.refresh();
    expect(listings.slice(0, 2)).toEqual(["?type=text", "?type=all"]);
    expect(adapter.catalog().length).toBeGreaterThan(0);
  });

  it("applies the same qualification through a bounded gateway key, with zero cost bounds", async () => {
    const { adapter, posts, exhaust } = gateway(); await adapter.refresh();
    await vi.waitFor(() => expect(posts).toHaveLength(3));
    await vi.waitFor(() => expect(freeRoute(adapter)).toBe(forge + "@glm-flash"));
    expect(recommended(adapter.catalog())).toEqual([FREE_ROUTE_ID]);
    expect(posts.every(body => body.mycellios_cost_bounds?.input === "0" && body.mycellios_cost_bounds?.output === "0")).toBe(true);
    // With their free sellers resting, those models are served by their priced sellers again.
    await adapter.refresh();
    expect(ids(adapter.catalog())).toEqual(["deepseek-flash", "glm-flash", "oss-small", "paid-model", "rival-free", "staked-old"]);
    expect(adapter.quote(chat("rival-free")).maximumMicrounits).toBeGreaterThan(0);
    expect(freeRoute(adapter)).toBe(forge + "@glm-flash");
    expect(posts).toHaveLength(3);
    const quote = adapter.quote(chat("glm-flash"));
    expect(quote).toMatchObject({ maximumUsd: "0", body: { model: forge + "@glm-flash", mycellios_cost_bounds: { version: 2, input: "0", output: "0" } } });
    exhaust();
    await expect(adapter.execute(quote, undefined, async () => {})).rejects.toThrow("managed_free_tier_exhausted");
    expect(ids(adapter.catalog())).not.toContain("glm-flash");
  });

  it("expires cooldowns and probe results on their own windows", async () => {
    let now = 0; const cooldown = new FreeOfferCooldown(() => now), probes = new FreeOfferProbes(() => now);
    cooldown.block(forge, "a"); cooldown.block(forge, "b", "stake");
    now = 15 * 60_000 + 1;
    expect([cooldown.blocked(forge, "a"), cooldown.blocked(forge, "b")]).toEqual([false, true]);
    now = 24 * 3_600_000 + 1;
    expect(cooldown.blocked(forge, "b")).toBe(false);
    const route = { free: true, signals: { key: "k", eligible: true, reference: 1, allowance: 0, reputation: 0 } };
    probes.record("k", true, 100);
    expect(probes.due([route])).toEqual([]);
    now += 2 * 3_600_000 + 1;
    expect(probes.due([route])).toEqual([route]);
  });

  it("reads the per-account free daily requests from operator configuration", () => {
    const env = { MYCELLIOS_MANAGED_PROVIDER_ENABLED: "true", MYCELLIOS_MANAGED_ANTSEED_CONTROL_SECRET: operatorSecret,
      MYCELLIOS_MANAGED_REQUEST_LIMIT_MICROUNITS: "2000000", MYCELLIOS_MANAGED_DAILY_LIMIT_MICROUNITS: "10000000" };
    expect(readManagedProviderConfig(env)?.freeDailyRequests).toBeUndefined();
    expect(readManagedProviderConfig({ ...env, MYCELLIOS_MANAGED_FREE_DAILY_REQUESTS: "20" })?.freeDailyRequests).toBe(20);
    expect(() => readManagedProviderConfig({ ...env, MYCELLIOS_MANAGED_FREE_DAILY_REQUESTS: "-1" })).toThrow("free_daily_requests_invalid");
    expect(() => readManagedProviderConfig({ ...env, MYCELLIOS_MANAGED_FREE_DAILY_REQUESTS: " " })).toThrow("free_daily_requests_invalid");
  });

  it("answers free limits with 429 and a plain explanation, also inside a stream", async () => {
    for (const [stream, code] of [[false, "managed_free_daily_limit_reached"], [true, "managed_free_tier_exhausted"]] as const) {
      const service = {
        replayFor: async () => null,
        quote: async () => { if (!stream) throw new Error(code); return { maximumMicrounits: 0, token: "t" }; },
        execute: async () => { throw new Error(code); },
      };
      const app = Fastify();
      app.post("/v1/chat/completions", (request, reply) => handleManagedChat(request, reply, service as never, { userId: "alice", apiKeyId: null }));
      try {
        const response = await app.inject({ method: "POST", url: "/v1/chat/completions", payload: { ...chat("glm-flash"), stream },
          headers: { "x-mycellios-funding": "contribution-credits", "idempotency-key": "free-limit-" + code } });
        if (stream) {
          expect(response.body).toContain(code);
          expect(response.body).toContain("Try again in a few minutes");
        } else {
          expect(response.statusCode).toBe(429);
          expect(response.json()).toMatchObject({ error: { code, message: expect.stringContaining("00:00 UTC") } });
        }
      } finally { await app.close(); }
    }
  });
});
