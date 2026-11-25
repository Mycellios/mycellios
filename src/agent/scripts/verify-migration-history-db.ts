import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { MIGRATION_HISTORY_UNKNOWN_EXIT } from "@mycellios/contracts";
import { databaseMigrationsMissingFrom, shippedMigrations } from "@mycellios/db";
import EmbeddedPostgres from "embedded-postgres";

// The check an install runs before it moves to this repository's images
// (specs/trusted-distribution, phase 1), on a disposable loopback PostgreSQL: this repository's
// real migrations, then a history row from a release it does not ship. Never reads a developer or
// production DATABASE_URL.
const run = promisify(execFile);
const migrations = path.resolve("packages/db/prisma/migrations");
const foreign = "29990101000000_from_a_newer_upstream_release";

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const directory = await mkdtemp(path.join(tmpdir(), "mycellios-migration-history-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: path.join(directory, "pg"),
  port,
  user: "postgres",
  password,
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

const url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
const isolated = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: url,
  DATABASE_MIGRATION_URL: url,
};

/** The CLI exactly as the target app image runs it: its exit status and what it printed. */
async function check(databaseUrl = url): Promise<{ status: number; output: string }> {
  try {
    const { stdout } = await run(
      process.execPath,
      [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        "apps/api/src/cli/check-migration-history.ts",
      ],
      {
        windowsHide: true,
        env: { ...isolated, DATABASE_URL: databaseUrl, DATABASE_MIGRATION_URL: databaseUrl },
      },
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { status: failed.code ?? -1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

try {
  await database.initialise();
  await database.start();
  const shipped = await shippedMigrations(migrations);
  assert.ok(shipped.length > 100, `only ${shipped.length} migrations found`);
  assert.ok(!shipped.includes(foreign));

  // A database that never ran a migration has nothing this release lacks.
  assert.deepEqual(await databaseMigrationsMissingFrom(url, migrations), []);
  assert.equal((await check()).status, 0);

  // This repository's own history, written by Prisma itself.
  await run(
    process.execPath,
    [
      path.resolve("node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      "packages/db/prisma.config.ts",
    ],
    { windowsHide: true, env: isolated, maxBuffer: 8 * 1024 * 1024 },
  );
  const sql = database.getPgClient();
  await sql.connect();
  try {
    const applied = await sql.query<{ count: string }>(
      "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    assert.equal(Number(applied.rows[0]?.count), shipped.length);
    assert.deepEqual(await databaseMigrationsMissingFrom(url, migrations), []);
    const clean = await check();
    assert.equal(clean.status, 0, clean.output);

    // A release this repository does not ship migrated the database: the move is refused.
    await sql.query(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      [randomUUID(), "f".repeat(64), foreign],
    );
    assert.deepEqual(await databaseMigrationsMissingFrom(url, migrations), [foreign]);
    const refused = await check();
    assert.equal(refused.status, MIGRATION_HISTORY_UNKNOWN_EXIT, refused.output);
    assert.match(refused.output, new RegExp(foreign));

    // A row marked rolled back no longer counts; a failed attempt still does.
    await sql.query(
      "UPDATE _prisma_migrations SET rolled_back_at = now() WHERE migration_name = $1",
      [foreign],
    );
    assert.equal((await check()).status, 0);
    await sql.query(
      `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), 0)`,
      [randomUUID(), "e".repeat(64), `${foreign}_failed`],
    );
    assert.equal((await check()).status, MIGRATION_HISTORY_UNKNOWN_EXIT);
    await sql.query("DELETE FROM _prisma_migrations WHERE migration_name LIKE $1", [`${foreign}%`]);

    // Prisma's schema parameter decides which history table is read.
    await sql.query(`CREATE SCHEMA tenant;
      CREATE TABLE tenant._prisma_migrations (LIKE public._prisma_migrations INCLUDING ALL);`);
    await sql.query(
      `INSERT INTO tenant._prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      [randomUUID(), "d".repeat(64), foreign],
    );
    assert.deepEqual(await databaseMigrationsMissingFrom(url, migrations), []);
    assert.deepEqual(await databaseMigrationsMissingFrom(`${url}?schema=tenant`, migrations), [
      foreign,
    ]);
    assert.equal((await check(`${url}?schema=tenant`)).status, MIGRATION_HISTORY_UNKNOWN_EXIT);
  } finally {
    await sql.end();
  }

  // The check fails closed, with another status, when it cannot read the database at all.
  const unreachable = await check(
    `postgresql://postgres:${password}@127.0.0.1:${port}/missing_database`,
  );
  assert.notEqual(unreachable.status, 0);
  assert.notEqual(unreachable.status, MIGRATION_HISTORY_UNKNOWN_EXIT);
  console.log(
    `PASS: ${shipped.length} shipped migrations recognised after a real migrate deploy; an unknown or failed history row refuses the move (exit ${MIGRATION_HISTORY_UNKNOWN_EXIT}), a rolled-back one does not; Prisma's schema parameter is honoured; an unreadable database fails closed (isolated PostgreSQL)`,
  );
} finally {
  await database.stop();
}
