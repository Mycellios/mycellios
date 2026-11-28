import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import Fastify, { type FastifyInstance } from "fastify";
import { MeshDatabase } from "../src/storage/database.js";
import { EconomicLedger } from "../src/economy/economic-ledger.js";
import { ContributionCreditWallet } from "../src/economy/contribution-credit-wallet.js";
import { ManagedPurchases } from "../src/economy/managed-purchases.js";
import { createGuestChatSchema } from "./fixtures/guest-chat-postgres.js";
import { ApiAccessManager } from "../src/coordinator/api-access.js";
import { ManagedGateway } from "../src/coordinator/managed-gateway.js";
import { GuestChat, leadingZeroBits, GUEST_RETENTION_MS, GUEST_SYSTEM_PROMPT, type GuestChatGateway } from "../src/coordinator/guest-chat.js";
import { mountGuestChat } from "../src/coordinator/guest-chat-routes.js";
import { guestChatConfigSchema, type GuestChatConfig } from "../src/core/guest-chat-config.js";

const url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
const origin = "https://guest.invalid", base = "/mobile/v1/guest";
const solve = (token: string, difficulty: number) => {
  for (let n = 0; ; n++) if (leadingZeroBits(createHash("sha256").update(token + ":" + n).digest("hex")) >= difficulty) return String(n);
};
const SECRET_TEXT = "my private question about a medical result";

describe.skipIf(!url)("registration-free guest chat on isolated PostgreSQL, fictional zero-priced sellers only", () => {
  const schema = "guest_test_" + randomBytes(5).toString("hex"), role = schema + "_native";
  const sql = postgres(url!, { max: 2, onnotice: () => {} });
  let db: MeshDatabase, api: ApiAccessManager, gateway: GuestChatGateway, service: GuestChat, app: FastifyInstance;
  let now: number, address: string, settings: Partial<GuestChatConfig>, price: string;
  const logs: string[] = [];
  const config = () => guestChatConfigSchema.parse({ publicOrigin: origin, secret: "g".repeat(43), powDifficulty: 8, ...settings });
  const provider = {
    provider: "fictional-test", ensureFresh: vi.fn(async () => {}), catalog: () => [],
    quote: vi.fn(() => ({ maximumUsd: price, maximumMicrounits: price === "0" ? 0 : 1041, expiresAt: Date.now() + 60_000,
      body: { max_tokens: 800 }, fundingCostBasisPoints: 0 })),
    execute: vi.fn(async (_quote: unknown, chunk?: (v: Record<string, unknown>) => void, _submitted?: unknown, _options?: unknown) => {
      chunk?.({ choices: [{ delta: { content: "Hola " } }] });
      chunk?.({ choices: [{ delta: { content: "invitado" } }] });
      return { receiptId: "test-receipt-" + randomUUID(), usd: "0", inputTokens: 12, outputTokens: 4,
        response: { id: "test-only", model: "mycellios/managed/free",
          choices: [{ index: 0, message: { role: "assistant", content: "Hola invitado" }, finish_reason: "stop" }] } };
    }),
  };
  const boot = async () => {
    await app?.close();
    service = new GuestChat(config(), db, gateway, () => now);
    expect(await service.initialize()).toBe(true);
    logs.length = 0;
    app = Fastify({ logger: { level: "trace", stream: { write: (line: string) => { logs.push(line); } } } });
    mountGuestChat(app, service, () => address);
    await app.ready();
  };
  const enter = async (nonce = randomBytes(32).toString("base64url"), headers: Record<string, string> = { origin }) => {
    const settings = (await app.inject({ method: "GET", url: base + "/config" })).json();
    const challenge = settings.challenge.token as string;
    return app.inject({ method: "POST", url: base + "/session", headers,
      payload: { nonce, challenge, solution: solve(challenge, settings.challenge.difficulty) } });
  };
  const cookieOf = (response: Awaited<ReturnType<typeof enter>>) => String(response.headers["set-cookie"]).split(";")[0]!;
  const turn = (cookie: string, messages: unknown = [{ role: "user", content: SECRET_TEXT }], key = randomUUID()) =>
    app.inject({ method: "POST", url: base + "/chat", headers: { origin, cookie, accept: "text/event-stream" }, payload: { key, messages } });
  const events = (body: string) => body.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));

  beforeAll(async () => {
    await createGuestChatSchema(sql, schema, role);
    db = await MeshDatabase.openPostgres(url!, schema);
    const wallet = new ContributionCreditWallet(db, new EconomicLedger(db, { receiptSigning: {
      keyId: "test-only", privateKey: generateKeyPairSync("ed25519").privateKey } }), true);
    await wallet.initialize();
    api = new ApiAccessManager(db, { starterTokens: 0, requestsPerMinute: 1000, maxConcurrent: 10, maxActiveKeys: 1 }, {}, true);
    const purchases = new ManagedPurchases(db, wallet, 10_000_000); await purchases.initialize();
    gateway = new ManagedGateway(db, purchases, api, provider, 200_000);
  });
  beforeEach(async () => {
    await db.raw.exec(`TRUNCATE guest_chat_sessions,guest_chat_usage,economic_managed_purchases,economic_credit_holds,
      economic_promotion_allocations,economic_promotional_grants,api_keys,api_usage,api_accounts,economic_ledger_entries CASCADE`);
    vi.clearAllMocks(); now = Date.UTC(2026, 10, 27, 12); address = "203.0.113.7"; settings = {}; price = "0";
    await boot();
  });
  afterAll(async () => { await app?.close(); await db?.close(); await sql.unsafe(`DROP SCHEMA ${schema} CASCADE; DROP ROLE ${role}`); await sql.end(); });

  it("chats over a scoped cookie on the free route with no retries, no wallet rows and no stored content", async () => {
    const config = await app.inject({ method: "GET", url: base + "/config" });
    expect(config.json()).toMatchObject({ enabled: true, limits: { messagesPerSession: 12, messageChars: 4000, historyMessages: 24 } });
    expect(config.headers["access-control-allow-origin"]).toBeUndefined();
    const entered = await enter();
    expect(entered.statusCode).toBe(200);
    expect(entered.json()).toMatchObject({ remaining: 12, limit: 12 });
    const header = String(entered.headers["set-cookie"]);
    expect(header).toMatch(/^__Secure-mycellios-guest=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}; Path=\/mobile\/v1\/guest; HttpOnly; SameSite=Strict; Max-Age=\d+; Secure$/);
    const cookie = cookieOf(entered);
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie } })).json()).toMatchObject({ remaining: 12 });

    const response = await turn(cookie);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const stream = events(response.body);
    expect(stream.filter(e => e.type === "delta").map(e => e.content).join("")).toBe("Hola invitado");
    expect(stream.at(-1)).toEqual({ type: "result", result: { status: "completed", content: "Hola invitado", remaining: 11 } });
    // Only the fixed free model and server-owned instructions reach the gateway, with the default free refusal retries.
    expect(provider.execute).toHaveBeenCalledTimes(1);
    expect(provider.execute.mock.calls[0]![3]).toBeUndefined();
    const quoted = provider.quote.mock.calls[0] as unknown as [{ model: string; max_tokens: number; messages: Array<{ role: string; content: string }> }];
    expect(quoted[0]).toMatchObject({ model: "mycellios/managed/free", max_tokens: 800 });
    expect(quoted[0].messages[0]).toEqual({ role: "system", content: GUEST_SYSTEM_PROMPT });

    const purchases = await db.raw.prepare("SELECT account_id,maximum_usd,state FROM economic_managed_purchases").all();
    expect(purchases).toEqual([expect.objectContaining({ maximum_usd: "0", state: "settled" })]);
    expect(String(purchases[0]!.account_id)).toMatch(/^guest:[0-9a-f-]{36}$/);
    expect(await db.raw.prepare("SELECT COUNT(*) AS n FROM economic_promotional_grants").get()).toMatchObject({ n: expect.anything() });
    expect(Number((await db.raw.prepare("SELECT COUNT(*) AS n FROM economic_promotional_grants").get())!.n)).toBe(0);
    expect(Number((await db.raw.prepare("SELECT COUNT(*) AS n FROM api_keys").get())!.n)).toBe(0);
    const stored = JSON.stringify([
      await db.raw.prepare("SELECT * FROM guest_chat_sessions").all(), await db.raw.prepare("SELECT * FROM guest_chat_usage").all()]);
    expect(stored).not.toContain("medical");
    expect(stored).not.toContain("203.0.113");
    expect(await db.raw.prepare("SELECT scope,count FROM guest_chat_usage WHERE scope NOT LIKE 'sessions:%' ORDER BY scope").all())
      .toEqual([{ scope: "global", count: 1 }, { scope: expect.stringMatching(/^prefix:[A-Za-z0-9_-]{32}$/), count: 1 }]);

    // Retrying the same message key replays the stored answer without another inference or count.
    const key = randomUUID();
    await turn(cookie, undefined, key);
    const replay = events((await turn(cookie, undefined, key)).body);
    expect(replay.at(-1)?.result).toMatchObject({ status: "completed", content: "Hola invitado" });
    expect(provider.execute).toHaveBeenCalledTimes(2);
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie } })).json()).toMatchObject({ remaining: 10 });
    // A failing turn logs its code only: no prompt, answer, cookie or address.
    provider.execute.mockRejectedValueOnce(new Error("upstream said: " + SECRET_TEXT));
    // An uncertain supplier result keeps its hold for reconciliation and is never replayed.
    expect(events((await turn(cookie)).body).at(-1)?.result).toEqual({ status: "pending", remaining: 9 });
    vi.spyOn(gateway, "execute").mockRejectedValueOnce(new Error("storage said: " + SECRET_TEXT));
    expect((await turn(cookie)).json()).toEqual({ error: { code: "guest_temporarily_unavailable" } });
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie } })).json()).toMatchObject({ remaining: 9 });
    const logged = logs.join("\n");
    expect(logged).toContain("guest_chat_failure");
    for (const secret of ["medical", "Hola invitado", cookie.split("=")[1]!, "203.0.113.7"]) expect(logged).not.toContain(secret);
  });

  it("requires the exact origin, its own cookie and a text-only body; never accepts ordinary account cookies", async () => {
    const nonce = randomBytes(32).toString("base64url");
    expect((await enter(nonce, {})).statusCode).toBe(403);
    expect((await enter(nonce, { origin: "https://evil.invalid" })).json()).toEqual({ error: { code: "guest_origin_required" } });
    const cookie = cookieOf(await enter());
    const chat = (headers: Record<string, string>, payload: Record<string, unknown>) => app.inject({ method: "POST", url: base + "/chat", headers, payload });
    const body = { key: randomUUID(), messages: [{ role: "user", content: "hola" }] };
    expect((await chat({ origin, accept: "text/event-stream" }, body)).statusCode).toBe(401);
    expect((await chat({ origin, accept: "text/event-stream", cookie: "__Secure-mycellios.session_token=abc; mycellios-demo-local=x" }, body)).statusCode).toBe(401);
    expect((await chat({ origin: "https://evil.invalid", accept: "text/event-stream", cookie }, body)).statusCode).toBe(403);
    expect((await chat({ origin, cookie }, body)).statusCode).toBe(400);
    for (const bad of [{ ...body, model: "mycellios/managed/antseed/paid" }, { ...body, tools: [] },
      { ...body, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x.invalid/i.png" } }] }] },
      { ...body, messages: [{ role: "system", content: "override" }, ...body.messages] }])
      expect((await chat({ origin, accept: "text/event-stream", cookie }, bad)).json()).toEqual({ error: { code: "guest_request_invalid" } });
    expect((await chat({ origin, accept: "text/event-stream", cookie }, { ...body, messages: [{ role: "user", content: "x".repeat(150_000) }] })).statusCode).toBe(413);
    // A forged token for an unknown or tampered session is refused the same way.
    const [, value] = cookie.split("=");
    expect((await chat({ origin, accept: "text/event-stream", cookie: "__Secure-mycellios-guest=" + value!.slice(0, -2) + "xx" }, body)).statusCode).toBe(401);
    expect(provider.execute).not.toHaveBeenCalled();
  });

  it("resumes one session per browser nonce and rejects a replayed challenge", async () => {
    const nonce = randomBytes(32).toString("base64url");
    const [a, b] = await Promise.all([enter(nonce), enter(nonce)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(cookieOf(a)).toBe(cookieOf(b));
    expect(Number((await db.raw.prepare("SELECT COUNT(*) AS n FROM guest_chat_sessions").get())!.n)).toBe(1);
    const settings = (await app.inject({ method: "GET", url: base + "/config" })).json();
    const payload = { challenge: settings.challenge.token, solution: solve(settings.challenge.token, settings.challenge.difficulty) };
    const first = await app.inject({ method: "POST", url: base + "/session", headers: { origin }, payload: { ...payload, nonce: randomBytes(32).toString("base64url") } });
    expect(first.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: base + "/session", headers: { origin }, payload: { ...payload, nonce: randomBytes(32).toString("base64url") } });
    expect(again.json()).toEqual({ error: { code: "guest_challenge_invalid" } });
    now += 6 * 60_000;
    const stale = await app.inject({ method: "POST", url: base + "/session", headers: { origin }, payload: { ...payload, nonce: randomBytes(32).toString("base64url") } });
    expect(stale.json()).toEqual({ error: { code: "guest_challenge_invalid" } });
  });

  it("admits a bounded number of sessions per network prefix per hour, also concurrently", async () => {
    settings = { sessionsPerPrefixHour: 2 }; await boot();
    const results = await Promise.all(Array.from({ length: 6 }, () => enter()));
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(2);
    expect(results.filter(r => r.statusCode === 429).every(r => r.json().error.code === "guest_sessions_limit")).toBe(true);
    address = "2001:db8:1:2::99";
    expect((await enter()).statusCode).toBe(200);
    address = "203.0.113.250";
    expect((await enter()).statusCode).toBe(429);
    now += 3_600_000;
    expect((await enter()).statusCode).toBe(200);
  });

  it("enforces per-session, per-prefix and global daily limits atomically and resets on the next UTC day", async () => {
    settings = { messagesPerSession: 2, messagesPerPrefixDay: 3, messagesPerDay: 4 }; await boot();
    const a = cookieOf(await enter()), b = cookieOf(await enter());
    expect(events((await turn(a)).body).at(-1)?.result.remaining).toBe(1);
    expect(events((await turn(a)).body).at(-1)?.result.remaining).toBe(0);
    expect((await turn(a)).json()).toEqual({ error: { code: "guest_session_limit_reached" } });
    expect((await turn(b)).statusCode).toBe(200);
    expect((await turn(b)).json()).toEqual({ error: { code: "guest_prefix_daily_limit" } });
    // The refused turn rolled back its session counter.
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie: b } })).json()).toMatchObject({ remaining: 1 });
    address = "198.51.100.4";
    const c = cookieOf(await enter());
    expect((await turn(c)).statusCode).toBe(200);
    expect((await turn(c)).json()).toEqual({ error: { code: "guest_daily_budget_reached" } });
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie: c } })).json()).toMatchObject({ remaining: 1 });
    expect(provider.execute).toHaveBeenCalledTimes(4);
    // 12:00 -> 01:00 UTC on the next day: daily counters reset, sessions have not expired yet.
    now += 13 * 3_600_000;
    expect((await turn(c)).statusCode).toBe(200);
    expect((await turn(a)).json()).toEqual({ error: { code: "guest_session_limit_reached" } });
    now += 11 * 3_600_000;
    expect((await turn(c)).json()).toEqual({ error: { code: "guest_session_expired" } });
  });

  it("bounds concurrent turns globally and per session", async () => {
    settings = { concurrentTurns: 1 }; await boot();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    provider.execute.mockImplementationOnce(async () => {
      await gate;
      return { receiptId: "test-receipt-" + randomUUID(), usd: "0", inputTokens: 1, outputTokens: 1,
        response: { id: "test-only", model: "mycellios/managed/free", choices: [{ index: 0, message: { role: "assistant", content: "tarde" }, finish_reason: "stop" }] } };
    });
    const a = cookieOf(await enter()), b = cookieOf(await enter());
    const slow = turn(a);
    await vi.waitFor(() => expect(provider.execute).toHaveBeenCalledTimes(1));
    expect((await turn(a)).json()).toEqual({ error: { code: "guest_request_in_progress" } });
    expect((await turn(b)).json()).toEqual({ error: { code: "guest_busy" } });
    release();
    expect(events((await slow).body).at(-1)?.result).toMatchObject({ content: "tarde" });
    expect((await turn(b)).statusCode).toBe(200);
  });

  it("gives the message back when the free seller refused before any work, and never takes a priced quote", async () => {
    const cookie = cookieOf(await enter());
    provider.execute.mockRejectedValueOnce(new Error("managed_free_tier_exhausted"));
    expect((await turn(cookie)).json()).toEqual({ error: { code: "guest_busy" } });
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie } })).json()).toMatchObject({ remaining: 12 });
    expect(await db.raw.prepare("SELECT scope,count FROM guest_chat_usage WHERE scope NOT LIKE 'sessions:%'").all())
      .toEqual(expect.arrayContaining([{ scope: "global", count: 0 }]));
    expect(await db.raw.prepare("SELECT state FROM economic_managed_purchases").all()).toEqual([{ state: "released" }]);
    price = "0.001";
    expect((await turn(cookie)).json()).toEqual({ error: { code: "guest_busy" } });
    expect(provider.execute).toHaveBeenCalledTimes(1);
    expect((await app.inject({ method: "GET", url: base + "/session", headers: { cookie } })).json()).toMatchObject({ remaining: 12 });
  });

  it("deletes sessions and counters 7 days after they end, as the privacy policy states", async () => {
    const cookie = cookieOf(await enter());
    expect((await turn(cookie)).statusCode).toBe(200);
    const count = async (table: string) => Number((await db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())!.n);
    expect(await count("guest_chat_sessions")).toBe(1);
    expect(await count("guest_chat_usage")).toBe(3);
    // A new visitor 7 days after the first session ended triggers the cleanup.
    now += 24 * 3_600_000 + GUEST_RETENTION_MS + 86_400_000 + 1;
    expect((await enter()).statusCode).toBe(200);
    expect(await count("guest_chat_sessions")).toBe(1);
    expect(await db.raw.prepare("SELECT scope FROM guest_chat_usage").all())
      .toEqual([{ scope: expect.stringMatching(/^sessions:/) }]);
  });

  it("reports itself unavailable without the owner tables instead of failing", async () => {
    await sql.unsafe(`ALTER TABLE ${schema}.guest_chat_usage RENAME TO guest_chat_usage_hidden`);
    try {
      const missing = new GuestChat(config(), db, gateway);
      expect(await missing.initialize()).toBe(false);
      const local = Fastify(); mountGuestChat(local, missing, () => address);
      expect((await local.inject({ method: "GET", url: base + "/config" })).json()).toEqual({ enabled: false });
      await local.close();
    } finally { await sql.unsafe(`ALTER TABLE ${schema}.guest_chat_usage_hidden RENAME TO guest_chat_usage`); }
    // Unprotected tables (no row-level security) are not accepted either, and neither is a missing free route.
    await sql.unsafe(`ALTER TABLE ${schema}.guest_chat_sessions DISABLE ROW LEVEL SECURITY`);
    try { expect(await new GuestChat(config(), db, gateway).initialize()).toBe(false); }
    finally { await sql.unsafe(`ALTER TABLE ${schema}.guest_chat_sessions ENABLE ROW LEVEL SECURITY`); }
    expect(await new GuestChat(config(), db, undefined).initialize()).toBe(false);
    expect(await new GuestChat(config(), db, gateway).initialize()).toBe(true);
  });
});
