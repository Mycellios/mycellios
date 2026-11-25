import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import { Hono } from "hono";
import pg from "pg";
import { mountMicoScriptsHttp } from "../apps/api/src/mico-scripts-http.js";

process.env.NODE_ENV = "test";
const {
  asSystem, createDb, findMicoScriptCredential, issueMicoScriptToken,
  readMicoScriptsSettings, revokeMicoScriptToken, setMicoScriptsEnabled,
} = await import("@mycellios/db");
const socket = createServer();
await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((done) => socket.close(() => done()));
const directory = await mkdtemp(join(tmpdir(), "mycellios-script-credentials-"));
const password = randomBytes(24).toString("hex");
const postgres = new EmbeddedPostgres({
  databaseDir: join(directory, "pg"), port, user: "postgres", password,
  persistent: true, createPostgresUser: false, autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
});
let db: ReturnType<typeof createDb> | undefined;
try {
  await postgres.initialise();
  await postgres.start();
  const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await promisify(execFile)(process.execPath, [
    resolve("node_modules/prisma/build/index.js"), "db", "push", "--config", "packages/db/prisma.config.ts",
  ], { env: { ...process.env, DATABASE_URL: url, DATABASE_MIGRATION_URL: url }, windowsHide: true });
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    await sql.query('DROP TABLE "mico_script_tokens", "mico_script_settings"');
    await sql.query(await readFile("packages/db/prisma/migrations/20261125180000_mico_script_credentials/migration.sql", "utf8"));
    const policies = await sql.query("SELECT count(*)::int AS n FROM pg_policies WHERE tablename IN ('mico_script_settings','mico_script_tokens')");
    assert.equal(policies.rows[0].n, 4);
  } finally {
    await sql.end();
  }
  db = createDb(url, { encryptContent: false, applicationName: "synthetic-script-credentials" });
  const prisma = asSystem(db.prisma, "isolated Mico Scripts credential fixtures");
  const org = await prisma.organization.create({ data: { id: "scripts-org", name: "Synthetic", slug: "scripts-check", createdAt: new Date() } });
  const space = await prisma.space.create({ data: { id: "scripts-space", name: "Synthetic", organizationId: org.id } });
  const user = await prisma.user.create({ data: { id: "scripts-owner", name: "Owner", email: "owner@example.invalid" } });
  const bot = await prisma.bot.create({ data: { spaceId: space.id, userId: user.id, name: "Synthetic", color: "#10B981" } });
  const scope = { botId: bot.id, spaceId: space.id, userId: user.id };
  assert.deepEqual(await readMicoScriptsSettings(prisma, scope), {
    enabled: false, requestsPerHour: 60, tokens: [], path: `/api/v1/micos/${bot.id}`,
  });
  assert.equal(await readMicoScriptsSettings(prisma, { ...scope, userId: "other" }), null);
  assert.equal((await issueMicoScriptToken(prisma, scope)).status, "unavailable");
  assert.equal(await setMicoScriptsEnabled(prisma, { ...scope, userId: "other" }, true, 60), null);
  assert.ok(await setMicoScriptsEnabled(prisma, scope, true, 60));
  const results = await Promise.all(Array.from({ length: 6 }, () => issueMicoScriptToken(prisma, scope)));
  const issued = results.filter((item) => item.status === "issued");
  assert.equal(issued.length, 5);
  assert.equal(results.filter((item) => item.status === "limit").length, 1);
  const { token, record } = issued[0]!;
  await prisma.routine.create({ data: {
    ...scope, name: "Synthetic routine", prompt: "Owner instructions", crons: [],
  } });
  const app = new Hono();
  mountMicoScriptsHttp(app, db.prisma);
  const path = `/api/v1/micos/${bot.id}`;
  const headers = { Authorization: `Bearer ${token}` };
  const info = await app.request(path, { headers });
  assert.equal(info.status, 200);
  assert.equal(info.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await info.json(), {
    mico: { id: bot.id, name: "Synthetic" },
    routines: [{
      id: (await prisma.routine.findFirstOrThrow({ where: scope })).id,
      name: "Synthetic routine",
      active: false,
    }],
    requestsPerHour: 60,
  });
  assert.equal((await app.request("/api/v1/micos/other", { headers })).status, 404);
  assert.equal((await app.request(path)).status, 404);
  const stored = await prisma.micoScriptToken.findUniqueOrThrow({ where: { id: record.id } });
  assert.match(stored.digest, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(stored).includes(token));
  const settings = await readMicoScriptsSettings(prisma, scope);
  assert.equal(settings?.tokens.length, 5);
  assert.deepEqual(Object.keys(settings!.tokens[0]!).sort(), ["createdAt", "hint", "id", "lastUsedAt"]);
  assert.equal(await findMicoScriptCredential(prisma, "other-mico", token), null);
  assert.equal((await findMicoScriptCredential(prisma, bot.id, token))?.userId, user.id);
  assert.equal(await revokeMicoScriptToken(prisma, { ...scope, spaceId: "other" }, record.id), false);
  const reader = new pg.Client({ connectionString: url });
  await reader.connect();
  try {
    await reader.query('CREATE ROLE scripts_fixture NOLOGIN');
    await reader.query('GRANT SELECT ON mico_script_tokens TO scripts_fixture');
    await reader.query('BEGIN; SET LOCAL ROLE scripts_fixture');
    await reader.query("SELECT set_config('app.space_id', $1, true), set_config('app.user_id', $2, true)", [space.id, user.id]);
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM mico_script_tokens')).rows[0].n, 5);
    await reader.query("SELECT set_config('app.user_id', 'other', true)");
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM mico_script_tokens')).rows[0].n, 0);
    await reader.query('ROLLBACK');
  } finally {
    await reader.end();
  }
  await setMicoScriptsEnabled(prisma, scope, false, 60);
  assert.equal(await findMicoScriptCredential(prisma, bot.id, token), null);
  assert.equal((await app.request(path, { headers })).status, 404);
  await setMicoScriptsEnabled(prisma, scope, true, 60);
  assert.ok(await revokeMicoScriptToken(prisma, scope, record.id));
  assert.equal(await findMicoScriptCredential(prisma, bot.id, token), null);
  assert.equal((await app.request(path, { headers })).status, 404);
  console.log("Isolated PostgreSQL: migration and RLS policies, default off, owner scope, concurrent cap, hashing, disable and revoke passed.");
} finally {
  await db?.prisma.$disconnect().catch(() => undefined);
  await db?.pool.end().catch(() => undefined);
  await postgres.stop().catch(() => undefined);
}
