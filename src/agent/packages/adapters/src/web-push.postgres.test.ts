import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDb, runAsSystem } from "@rakazo/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import webpush from "web-push";
import { WebPushService } from "./web-push.js";
import type { VapidConfig } from "./web-push.js";
import { micoAvatarValue, type WebPushSubscription } from "@rakazo/contracts";
import type { AdapterContext, JobPublisher, NotificationMessage } from "@rakazo/adapter-kit";

// This suite can only touch the task's disposable, loopback database.
const connection = process.env.WEB_PUSH_TEST_DATABASE;
const database = connection ? new URL(connection) : undefined;
const suite = database?.protocol === "postgresql:" && database.hostname === "127.0.0.1" &&
  database.port === "55448" && database.pathname === "/notifications"
  ? describe.sequential
  : describe.skip;
suite("Web Push on isolated PostgreSQL", () => {
  let db: ReturnType<typeof createDb>;
  let worker: ReturnType<typeof createDb>;
  let service: WebPushService;
  const jobs = { enqueue: vi.fn(async () => undefined) } as unknown as JobPublisher;
  const sender = vi.fn(
    async (_subscription: WebPushSubscription, _payload: string, _config: VapidConfig) => undefined,
  );
  const pair = webpush.generateVAPIDKeys();
  const subscription = (id = "a") => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    keys: { p256dh: pair.publicKey, auth: Buffer.alloc(16).toString("base64url") },
  });
  const clientId = randomUUID();
  const context = { userId: "alice", spaceId: "space", runId: "run" } as AdapterContext;
  const message: NotificationMessage = {
    kind: "help",
    title: "Private question",
    body: "private content",
    botId: "bot",
    threadId: "thread",
  };
  const sql = <T>(fn: () => Promise<T>) => runAsSystem("isolated web push fixture", fn);
  beforeAll(async () => {
    db = createDb(connection!, { encryptContent: false });
    worker = createDb(connection!, { encryptContent: false });
    // Fixtures deliberately have no business data or production credentials.
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS "user" (id text PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS "session" (id text PRIMARY KEY, "userId" text, "expiresAt" timestamptz);
      CREATE TABLE IF NOT EXISTS bots (id text PRIMARY KEY, "userId" text, name text, "notifyOnFinish" boolean, "archivedAt" timestamptz);
      ALTER TABLE bots ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#8654e6';
      CREATE TABLE IF NOT EXISTS chat_groups (id text PRIMARY KEY, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS spaces (id text PRIMARY KEY, "organizationId" text);
      CREATE TABLE IF NOT EXISTS space_members (id text PRIMARY KEY, "spaceId" text, "organizationId" text, "userId" text);
      CREATE TABLE IF NOT EXISTS threads (id text PRIMARY KEY, unread boolean);
      ALTER TABLE threads ADD COLUMN IF NOT EXISTS "groupId" text;
      CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, "runId" text, type text, seq integer);
      ALTER TABLE events ADD COLUMN IF NOT EXISTS "createdAt" timestamptz NOT NULL DEFAULT now();
      CREATE TABLE IF NOT EXISTS runs (id text PRIMARY KEY, "userId" text, "spaceId" text, "botId" text, "threadId" text, status text, "updatedAt" timestamptz);
    `);
    const migration = await fs.readFile(
      new URL("../../db/prisma/migrations/20261108010000_web_push/migration.sql", import.meta.url),
      "utf8",
    );
    await db.pool.query(
      "DROP TABLE IF EXISTS web_push_deliveries, web_push_devices, web_push_settings, web_push_presence CASCADE",
    );
    await db.pool.query(migration);
  });
  beforeEach(async () => {
    await db.pool.query(`TRUNCATE web_push_deliveries, web_push_devices, web_push_settings, web_push_presence, "user", "session", bots, spaces, space_members, threads, events, runs CASCADE;
      INSERT INTO "user" VALUES ('alice'), ('bob');
      INSERT INTO "session" VALUES ('session-a','alice',now()+interval '1 hour'),('session-b','bob',now()+interval '1 hour');
      INSERT INTO bots (id, "userId", name, "notifyOnFinish", "archivedAt") VALUES ('bot','alice','Mico',true,null), ('foreign','bob','Other',true,null);
      INSERT INTO spaces VALUES ('space','org');
      INSERT INTO space_members VALUES ('member','space','org','alice');
      INSERT INTO threads VALUES ('thread',true,null);
      INSERT INTO events (id,"runId",type,seq) VALUES ('event-ask','run','run.waiting_input',1);
      INSERT INTO runs VALUES ('run','alice','space','bot','thread','waiting_input',now());`);
    sender.mockReset();
    sender.mockResolvedValue(undefined);
    vi.mocked(jobs.enqueue).mockClear();
    service = new WebPushService(
      db.prisma,
      "fixture-encryption-only",
      jobs,
      { ...pair, subject: "mailto:test@example.invalid" },
      sender,
    );
  });
  afterAll(async () => {
    service?.stop();
    await Promise.all([db?.pool.end(), worker?.pool.end()]);
  });
  const register = () => service.register("alice", "session-a", clientId, subscription());
  const pending = () =>
    sql(
      () =>
        db.prisma.$queryRaw<
          Array<{ id: string; attempts: number; ciphertext: string; finishedAt: Date | null }>
        >`SELECT * FROM web_push_deliveries`,
    );
  async function due() {
    await db.pool.query("UPDATE web_push_deliveries SET \"dueAt\"=now()-interval '1 second'");
  }
  it("encrypts subscriptions, supports multiple devices and survives independent API/worker instances", async () => {
    await register();
    await service.register("alice", "session-a", randomUUID(), subscription("second"));
    const rows = await sql(
      () =>
        db.prisma.$queryRaw<Array<{ ciphertext: string }>>`SELECT ciphertext FROM web_push_devices`,
    );
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain("fcm.googleapis.com");
    const other = new WebPushService(
      worker.prisma,
      "fixture-encryption-only",
      jobs,
      { ...pair, subject: "mailto:test@example.invalid" },
      sender,
    );
    expect((await other.status("alice", "session-a", clientId)).registered).toBe(true);
    expect((await other.status("bob", "session-b", clientId)).registered).toBe(false);
  });
  it("rejects expired/foreign sessions and endpoint transfers between accounts", async () => {
    await expect(service.register("alice", "session-b", clientId, subscription())).rejects.toThrow(
      "session ended",
    );
    await register();
    await expect(
      service.register("bob", "session-b", randomUUID(), subscription()),
    ).rejects.toThrow("changing accounts");
    await db.pool.query(
      "UPDATE \"session\" SET \"expiresAt\"=now()-interval '1 second' WHERE id='session-a'",
    );
    await expect(register()).rejects.toThrow("session ended");
  });
  it("preserves other devices when revoking one and prevents re-registration after logout", async () => {
    await register();
    await service.register("alice", "session-a", randomUUID(), subscription("second"));
    await service.unregister("alice", "session-a", clientId);
    expect((await service.status("alice", "session-a", clientId)).registered).toBe(false);
    await service.endSession("alice", "session-a");
    await db.pool.query("DELETE FROM \"session\" WHERE id='session-a'");
    await expect(register()).rejects.toThrow();
    expect(
      await sql(() => db.prisma.$queryRaw<unknown[]>`SELECT * FROM web_push_devices`),
    ).toHaveLength(0);
  });
  it("protects per-Mico preferences from cross-account writes", async () => {
    await expect(
      service.saveSettings("alice", {
        level: "all",
        previews: false,
        mutedUntil: null,
        bots: { foreign: "off" },
      }),
    ).rejects.toThrow();
    const settings = {
      level: "needs_me" as const,
      previews: false,
      mutedUntil: null,
      bots: { bot: "all" as const },
    };
    await service.saveSettings("alice", settings);
    expect(await service.settings("alice")).toEqual(settings);
    expect((await service.settings("bob")).level).toBe("all");
  });
  it("deduplicates durable jobs and sends only one notification after worker contention", async () => {
    await register();
    await Promise.all([service.enqueue(message, context), service.enqueue(message, context)]);
    const rows = await pending();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ciphertext).not.toContain("private content");
    await due();
    await Promise.all([service.deliver(rows[0]!.id), service.deliver(rows[0]!.id)]);
    expect(sender).toHaveBeenCalledOnce();
    expect(JSON.parse(sender.mock.calls[0]![1] as string)).toMatchObject({
      accountId: "alice",
      body: "Your Mico needs your answer.",
    });
    expect((await pending())[0]!.finishedAt).not.toBeNull();
  });
  it.each([429, 503])(
    "retries a transient %s durably, without re-running tools",
    async (statusCode) => {
      await register();
      await service.enqueue(message, context);
      await due();
      const [row] = await pending();
      sender.mockRejectedValueOnce({ statusCode });
      await service.deliver(row!.id);
      expect((await pending())[0]!.finishedAt).toBeNull();
      await due();
      await service.deliver(row!.id);
      expect(sender).toHaveBeenCalledTimes(2);
      expect((await pending())[0]!.finishedAt).not.toBeNull();
    },
  );
  it.each([404, 410])("removes gone subscription (%s)", async (statusCode) => {
    await register();
    await service.enqueue(message, context);
    await due();
    sender.mockRejectedValueOnce({ statusCode });
    const [row] = await pending();
    await service.deliver(row!.id);
    expect((await service.status("alice", "session-a", clientId)).registered).toBe(false);
  });
  it.each(["answered", "read", "session", "member", "muted"])(
    "drops stale notifications after %s",
    async (condition) => {
      await register();
      await service.enqueue(message, context);
      await due();
      const [row] = await pending();
      if (condition === "answered")
        await db.pool.query("UPDATE runs SET status='running', \"updatedAt\"=now()");
      if (condition === "read") await db.pool.query("UPDATE threads SET unread=false");
      if (condition === "session") await db.pool.query('DELETE FROM "session"');
      if (condition === "member") await db.pool.query("DELETE FROM space_members");
      if (condition === "muted")
        await service.saveSettings("alice", {
          level: "off",
          previews: false,
          mutedUntil: null,
          bots: {},
        });
      await service.deliver(row!.id);
      expect(sender).not.toHaveBeenCalled();
      expect((await pending())[0]!.finishedAt).not.toBeNull();
    },
  );
  it("holds while a device is active and drops the hold once the result is read", async () => {
    await register();
    await service.enqueue(message, context);
    await due();
    const [row] = await pending();
    await service.presence("alice", "session-a", clientId, true);
    await service.deliver(row!.id);
    expect(sender).not.toHaveBeenCalled();
    await db.pool.query("UPDATE threads SET unread=false");
    await due();
    await service.deliver(row!.id);
    expect(sender).not.toHaveBeenCalled();
  });
  it("keeps new avatar artwork out of the field used by older installed workers", async () => {
    await db.pool.query("UPDATE bots SET color=$1 WHERE id='bot'", [micoAvatarValue(1012, "#7D859A")]);
    await service.saveSettings("alice", { level: "all", previews: true, mutedUntil: null, bots: {} });
    await register();
    await service.enqueue(message, context);
    await due();
    const [row] = await pending();
    await service.deliver(row!.id);
    const payload = JSON.parse(sender.mock.calls[0]![1] as string);
    expect(payload.avatarArt).toBe("raven");
    expect(payload).not.toHaveProperty("avatar");
  });
  it("turning previews off while queued removes previously enabled content", async () => {
    await db.pool.query("UPDATE bots SET color=$1 WHERE id='bot'", [micoAvatarValue(1012, "#7D859A")]);
    await service.saveSettings("alice", {
      level: "all",
      previews: true,
      mutedUntil: null,
      bots: {},
    });
    await register();
    await service.enqueue(message, context);
    await due();
    const [row] = await pending();
    await service.saveSettings("alice", {
      level: "all",
      previews: false,
      mutedUntil: null,
      bots: {},
    });
    await service.deliver(row!.id);
    const payload = JSON.parse(sender.mock.calls[0]![1] as string);
    expect(payload).toMatchObject({
      title: "Mycellios",
      body: "Your Mico needs your answer.",
    });
    expect(payload).not.toHaveProperty("avatarArt");
  });
  it("executor cleanup does not invalidate an unanswered question", async () => {
    await register(); await service.enqueue(message, context); await due(); const [row] = await pending();
    await db.pool.query("UPDATE runs SET \"updatedAt\"=now()+interval '1 second'");
    await service.deliver(row!.id); expect(sender).toHaveBeenCalledOnce();
  });
  it("a later question in the same run supersedes the pending earlier question", async () => {
    await register(); await service.enqueue(message, context); await due(); const [row] = await pending();
    await db.pool.query("INSERT INTO events (id,\"runId\",type,seq) VALUES ('event-next','run','run.waiting_input',2)");
    await service.deliver(row!.id); expect(sender).not.toHaveBeenCalled();
    await service.enqueue(message, context); await due(); const next = (await pending()).find(item => item.id !== row!.id);
    await service.deliver(next!.id); expect(sender).toHaveBeenCalledOnce();
  });
  it("a focused Desktop session holds phone delivery without registering a push endpoint", async () => {
    await register(); await service.enqueue(message, context); await due(); const [row] = await pending();
    await service.presence("alice", "session-a", randomUUID(), true);
    await service.deliver(row!.id); expect(sender).not.toHaveBeenCalled();
  });
  it("RLS denies unscoped account registrations even with direct SQL", async () => {
    await register();
    // A real non-owner role, so the table owner's PostgreSQL bypass cannot hide missing policies.
    await db.pool.query(
      "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='notification_reader') THEN CREATE ROLE notification_reader; END IF; END $$; GRANT SELECT ON web_push_devices TO notification_reader",
    );
    const c = await db.pool.connect();
    try {
      await c.query(
        "BEGIN; SET LOCAL ROLE notification_reader; SELECT set_config('app.rls_bypass','off',true)",
      );
      expect((await c.query("SELECT * FROM web_push_devices")).rows).toHaveLength(0);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });
});
