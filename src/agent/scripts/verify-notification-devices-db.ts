import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createDb, runAsSystem } from "@rakazo/db";
import webpush from "web-push";
import { WebPushService } from "../packages/adapters/src/web-push.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

// Isolated loopback database only; never reads the developer or production DATABASE_URL.
const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-push-devices-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port, user: "postgres", password,
  persistent: true, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
const run = promisify(execFile);
try {
  await database.initialise(); await database.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await run(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts"],
    { windowsHide: true, env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, maxBuffer: 1024 * 1024 });
  const sql = database.getPgClient(); await sql.connect();
  try {
    // These empty tables belong only to this newly created fixture database.
    await sql.query("DROP TABLE web_push_deliveries, web_push_devices, web_push_presence, web_push_settings, mobile_push_devices, push_tokens");
    await sql.query(await readFile("packages/db/prisma/migrations/20261023120000_push_tokens/migration.sql", "utf8"));
    await sql.query(await readFile("packages/db/prisma/migrations/20261112110000_mobile_push_devices/migration.sql", "utf8"));
    await sql.query(await readFile("packages/db/prisma/migrations/20261108010000_web_push/migration.sql", "utf8"));
    await sql.query(`CREATE ROLE push_device_test LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS; ALTER ROLE push_device_test SET timezone='Europe/Paris'; GRANT USAGE ON SCHEMA public TO push_device_test; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO push_device_test`);
  } finally { await sql.end(); }
  const runtimeUrl = `postgresql://push_device_test:${password}@127.0.0.1:${port}/postgres`;
  const db = createDb(runtimeUrl, { encryptContent: false });
  try {
    const owner = randomUUID(), first = randomUUID(), next = randomUUID(), client = randomUUID();
    await runAsSystem("seed isolated timezone regression", async () => {
      await db.prisma.user.create({ data: { id: owner, name: "Fixture", email: `${owner}@example.invalid` } });
      for (const id of [first, next]) await db.prisma.session.create({ data: { id, userId: owner, token: randomUUID(), expiresAt: new Date(Date.now() + 3600_000) } });
    });
    const pair = webpush.generateVAPIDKeys();
    const service = new WebPushService(db.prisma, "synthetic-notification-encryption", { enqueue: async () => undefined } as never,
      { ...pair, subject: "mailto:fixture@example.invalid" });
    await service.register(owner, first, client, { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: pair.publicKey, auth: Buffer.alloc(16).toString("base64url") } });
    assert.equal(await service.hasRecipient(owner), true);
    await service.presence(owner, first, client, true);
    await service.endSession(owner, first, next);
    assert.equal((await service.status(owner, next, client)).registered, true);
    await runAsSystem("expire timezone fixture", () => db.prisma.session.update({ where: { id: next }, data: { expiresAt: new Date(0) } }));
    assert.equal(await service.hasRecipient(owner), false);
    await assert.rejects(service.register(owner, next, client, { endpoint: "https://fcm.googleapis.com/fcm/send/fixture", keys: { p256dh: pair.publicKey, auth: Buffer.alloc(16).toString("base64url") } }));
    console.log("Web Push registration, presence and session replacement verified with non-UTC PostgreSQL timezone.");
  } finally { await db.pool.end(); }
  const result = await run(process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run", "packages/adapters/src/push-token-store.postgres.test.ts"],
    { windowsHide: true, env: { ...process.env, VERIFY_DATABASE: "1", DATABASE_URL: runtimeUrl }, maxBuffer: 2 * 1024 * 1024 }).catch(error => { process.stdout.write(error.stdout ?? ""); process.stderr.write(error.stderr ?? ""); process.exitCode = 1; return null; });
  if (!result) throw new Error("Notification database qualification failed; see test failures above.");
  process.stdout.write(result.stdout);
  console.log("Actual additive migration, encrypted multi-device registration, account handover and RLS verified on isolated PostgreSQL.");
} finally { await database.stop(); }
