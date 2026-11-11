import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const socket = createServer();
await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>(resolve => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-tailnet-db-"));
const database = new EmbeddedPostgres({ databaseDir: path.join(directory, "pg"), port,
  user: "postgres", password: randomBytes(24).toString("hex"), persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"], autoRehydrateSymlinks: true,
  onLog: () => {}, onError: () => {} });
try {
  await database.initialise(); await database.start();
  const sql = database.getPgClient(); await sql.connect();
  try {
    // Minimal owning-table fixture: exercise the published migration itself,
    // including PostgreSQL policies, rather than Prisma db push's policy-free schema.
    await sql.query(`CREATE TABLE spaces(id TEXT PRIMARY KEY);
      CREATE TABLE "user"(id TEXT PRIMARY KEY);
      CREATE TABLE mcp_servers(id TEXT PRIMARY KEY);
      INSERT INTO spaces VALUES ('space-a'), ('space-b');
      INSERT INTO "user" VALUES ('owner-a'), ('owner-b');`);
    await sql.query(await readFile("packages/db/prisma/migrations/20261111120000_tailscale_connections/migration.sql", "utf8"));
    await sql.query(`INSERT INTO mcp_servers(id) VALUES ('legacy');
      INSERT INTO tailnet_connections(id,"spaceId","userId",name,kind,"dnsSuffix") VALUES
      ('network-a','space-a','owner-a','Home','personal','tail123.ts.net'),
      ('network-b','space-b','owner-b','Office','company','tail456.ts.net');
      INSERT INTO tailnet_policies(id,"spaceId","dnsSuffix") VALUES ('policy-a','space-a','tail123.ts.net'),('policy-b','space-b','tail456.ts.net');
      CREATE ROLE tailnet_test NOLOGIN NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO tailnet_test;
      GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tailnet_test;
      SET ROLE tailnet_test;`);
    assert.equal((await sql.query('SELECT * FROM tailnet_connections')).rowCount, 0);
    await sql.query("SELECT set_config('app.space_id','space-a',false),set_config('app.user_id','owner-a',false)");
    assert.deepEqual((await sql.query('SELECT id FROM tailnet_connections')).rows, [{ id: "network-a" }]);
    assert.deepEqual((await sql.query('SELECT id FROM tailnet_policies')).rows, [{ id: "policy-a" }]);
    assert.equal((await sql.query("UPDATE tailnet_connections SET enabled=true WHERE id='network-b'")).rowCount, 0);
    await assert.rejects(sql.query(`INSERT INTO tailnet_connections(id,"spaceId","userId",name,kind,"dnsSuffix")
      VALUES ('forged','space-b','owner-b','x','personal','tail456.ts.net')`), /row-level security/);
    await sql.query("SELECT set_config('app.user_id','owner-b',false)");
    assert.equal((await sql.query('SELECT * FROM tailnet_connections')).rowCount, 0);
    await sql.query('RESET ROLE');
    await assert.rejects(sql.query(`INSERT INTO mcp_servers(id,"networkId") VALUES ('bad-binding','missing')`), /foreign key/);
    assert.equal((await sql.query('SELECT "networkId" FROM mcp_servers WHERE id=\'legacy\'')).rows[0].networkId, null);
    console.log("PASS: additive migration, legacy MCP rows, network foreign key, owner/Space RLS, policy Space RLS and forged-write refusal (isolated PostgreSQL)");
  } finally { await sql.end(); }
} finally { await database.stop(); }
