import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatCompletionRequest } from "../src/contracts/types.js";
import {
  API_KEY_PREFIX,
  ApiAccessError,
  ApiAccessManager,
  LIVE_USAGE_WINDOW_MS,
} from "../src/coordinator/api-access.js";
import { MeshDatabase } from "../src/storage/database.js";

const request: ChatCompletionRequest = {
  model: "real-model",
  messages: [{ role: "user", content: "hola" }],
  max_tokens: 10,
  stream: false,
};

describe("API access accounting", () => {
  let database: MeshDatabase;
  let access: ApiAccessManager;

  beforeEach(async () => {
    database = (await MeshDatabase.open(":memory:"));
    access = new ApiAccessManager(database, {
      starterTokens: 100,
      requestsPerMinute: 2,
      maxConcurrent: 1,
      maxActiveKeys: 2,
    });
  });

  afterEach(async () => (await database.close()));

  it("reads an existing account without the serialized write transaction", async () => {
    const transaction = database.transaction.bind(database);
    let transactions = 0;
    database.transaction = (async (operation: () => unknown) => {
      transactions++;
      return transaction(operation);
    }) as typeof database.transaction;
    const created = await access.getOrCreateAccount("user-1");
    expect(transactions).toBe(1);
    await expect(access.getOrCreateAccount("user-1")).resolves.toEqual(created);
    await expect(access.getOrCreateAccount("user-1")).resolves.toEqual(created);
    expect(transactions).toBe(1);
  });

  it("creates hashed, revocable keys and only returns the full secret once", async () => {
    const created = (await access.createKey("user-1", "Production"));
    expect(created.secret).toMatch(/^myc_live_[A-Za-z0-9_-]{10}_[A-Za-z0-9_-]{43}$/);
    expect(created.prefix).toHaveLength(10);
    expect((await access.listKeys("user-1"))).toEqual([
      expect.objectContaining({ id: created.id, name: "Production" }),
    ]);
    expect(JSON.stringify((await access.listKeys("user-1")))).not.toContain(created.secret);
    const stored = (await database.raw.prepare("SELECT secret_hash FROM api_keys WHERE id = ?")
      .get(created.id)) as { secret_hash: string };
    expect(stored.secret_hash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
    expect((await access.authenticateKey(created.secret))).toEqual({
      kind: "api_key",
      userId: "user-1",
      apiKeyId: created.id,
    });
    expect((await access.revokeKey("user-1", created.id))).toBe(true);
    expect((await access.authenticateKey(created.secret))).toBeNull();
    expect(created.secret.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("upgrades a valid legacy API-key hash after authentication", async () => {
    const token = "myc_live_ABCDEFGHIJ_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const legacyHash = "d3b25274d98f95b96e11a283738dd14f6c7e16de4debbfac4c0dfc432e706272";
    const now = Date.now();
    (await access.getOrCreateAccount("user-1"));
    (await database.raw.prepare(
      "INSERT INTO api_keys(id, user_id, name, prefix, secret_hash, created_at, last_used_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
    ).run("key-legacy", "user-1", "Legacy", "ABCDEFGHIJ", legacyHash, now));

    expect((await access.authenticateKey(token))).toMatchObject({ apiKeyId: "key-legacy" });
    const migrated = (await database.raw.prepare("SELECT secret_hash FROM api_keys WHERE id = ?")
      .get("key-legacy")) as { secret_hash: string };
    expect(migrated.secret_hash).toMatch(/^scrypt\$/);
    expect(migrated.secret_hash).not.toBe(legacyHash);
  });

  it("reserves the maximum cost before dispatch and reconciles the real token count", async () => {
    const reservation = (await access.beginUsage("user-1", null, request));
    expect(reservation.reservedTokens).toBe(12);
    expect(reservation.remainingTokens).toBe(88);
    (await access.attachJob(reservation.id, "job-1", "session-1"));

    const account = (await access.completeUsage(reservation.id, 4, 6));
    expect(account).toEqual(expect.objectContaining({
      tokenBalance: 90,
      lifetimeInputTokens: 4,
      lifetimeOutputTokens: 6,
      requestCount: 1,
    }));
    expect((await access.userOwnsJob("user-1", "job-1"))).toBe(true);
    expect((await access.userOwnsSession("user-1", "session-1"))).toBe(true);
    expect((await access.listUsage("user-1"))[0]).toEqual(expect.objectContaining({
      status: "completed",
      inputTokens: 4,
      outputTokens: 6,
    }));
  });

  it("does not let leaked pending reservations hold concurrency slots forever", async () => {
    const leak = async (id: string, createdAt: number, jobId: string | null) => {
      (await database.raw.prepare(
        `INSERT INTO api_usage(id, user_id, api_key_id, job_id, session_id, model, reserved_tokens,
           input_tokens, output_tokens, status, error_code, created_at, completed_at)
         VALUES (?, 'user-1', NULL, ?, NULL, 'real-model', 0, 0, 0, 'pending', NULL, ?, NULL)`,
      ).run(id, jobId, createdAt));
    };
    (await access.getOrCreateAccount("user-1"));
    // Older than any admitted request can live, with or without a job.
    (await leak("use-old", Date.now() - LIVE_USAGE_WINDOW_MS - 1_000, null));
    // Recent, but its job already reached a terminal state.
    (await database.raw.prepare(
      `INSERT INTO jobs(id, session_id, model, workload_class, status, deadline_at, created_at, updated_at)
       VALUES ('job-done', 'session-1', 'real-model', 'interactive', 'completed', ?, ?, ?)`,
    ).run(Date.now(), Date.now(), Date.now()));
    (await leak("use-done", Date.now() - 120_000, "job-done"));

    const live = (await access.beginUsage("user-1", null, request));
    await expect(access.beginUsage("user-1", null, request)).rejects.toMatchObject({
      code: "concurrency_limit_exceeded", statusCode: 429,
    });
    (await access.failUsage(live.id, "worker_failed"));
  });

  it("finalizes leaked token reservations from their job outcome and spares funded or live rows", async () => {
    access = new ApiAccessManager(database, {
      starterTokens: 100, requestsPerMinute: 2, maxConcurrent: 1, maxActiveKeys: 2,
    }, {}, true);
    (await access.getOrCreateAccount("user-1"));
    const old = Date.now() - LIVE_USAGE_WINDOW_MS - 1_000;
    const job = async (id: string, status: string, input: number, output: number) => (await database.raw.prepare(
      `INSERT INTO jobs(id, session_id, model, workload_class, status, deadline_at, created_at, updated_at, input_tokens, output_tokens)
       VALUES (?, 'session-1', 'real-model', 'interactive', ?, ?, ?, ?, ?, ?)`,
    ).run(id, status, old, old, old, input, output));
    const leak = async (id: string, jobId: string | null, createdAt = old) => (await database.raw.prepare(
      `INSERT INTO api_usage(id, user_id, api_key_id, job_id, session_id, model, reserved_tokens,
         input_tokens, output_tokens, status, error_code, created_at, completed_at)
       VALUES (?, 'user-1', NULL, ?, NULL, 'real-model', 10, 0, 0, 'pending', NULL, ?, NULL)`,
    ).run(id, jobId, createdAt));
    (await database.raw.prepare("UPDATE api_accounts SET token_balance = 60 WHERE user_id = 'user-1'").run());
    (await job("job-ok", "completed", 3, 4));
    (await job("job-bad", "failed", 0, 0));
    (await job("job-live", "running", 0, 0));
    (await leak("use-ok", "job-ok"));
    (await leak("use-bad", "job-bad"));
    (await leak("use-nojob", null));
    (await leak("use-live", "job-live"));
    (await leak("use-recent", null, Date.now() - 60_000));
    (await leak("use-funded", null));
    (await database.raw.exec("CREATE TABLE IF NOT EXISTS api_contribution_funded_usage (usage_id TEXT PRIMARY KEY)"));
    (await database.raw.prepare("INSERT INTO api_contribution_funded_usage(usage_id) VALUES ('use-funded')").run());

    expect(await access.finalizeLeakedUsage("user-1")).toBe(3);
    const status = async (id: string) => (await database.raw.prepare(
      "SELECT status, error_code, input_tokens, output_tokens FROM api_usage WHERE id = ?").get(id));
    expect(await status("use-ok")).toMatchObject({ status: "completed", input_tokens: 3, output_tokens: 4 });
    expect(await status("use-bad")).toMatchObject({ status: "failed", error_code: "usage_finalization_lost_failed" });
    expect(await status("use-nojob")).toMatchObject({ status: "failed", error_code: "usage_finalization_lost" });
    for (const id of ["use-live", "use-recent", "use-funded"]) expect(await status(id)).toMatchObject({ status: "pending" });
    // 60 + (10 - 7) refund for the completed job + 10 + 10 refunds for the others.
    expect((await access.getOrCreateAccount("user-1")).tokenBalance).toBe(83);
    expect(await access.finalizeLeakedUsage("user-1")).toBe(0);
  });

  it("refunds a failed request and enforces concurrency, rate and balance limits", async () => {
    const first = (await access.beginUsage("user-1", null, request));
    await expect((async () => (await access.beginUsage("user-1", null, request)))()).rejects.toThrowError(
      expect.objectContaining({ code: "concurrency_limit_exceeded", statusCode: 429 }),
    );
    (await access.failUsage(first.id, "worker_failed"));
    expect((await access.getOrCreateAccount("user-1")).tokenBalance).toBe(100);

    const second = (await access.beginUsage("user-1", null, request));
    (await access.completeUsage(second.id, 2, 2));
    await expect((async () => (await access.beginUsage("user-1", null, request)))()).rejects.toThrowError(
      expect.objectContaining({ code: "rate_limit_exceeded", statusCode: 429 }),
    );

    (await access.getOrCreateAccount("poor-user"));
    (await database.raw.prepare(
      "UPDATE api_accounts SET token_balance = 1 WHERE user_id = 'poor-user'",
    ).run());
    await expect((async () => (await access.beginUsage("poor-user", null, request)))()).rejects.toThrowError(
      expect.objectContaining({
        code: "insufficient_token_balance",
        statusCode: 402,
      } satisfies Partial<ApiAccessError>),
    );
  });
});
