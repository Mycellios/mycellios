import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import {
  blockingViolations,
  isContractMigration,
  migrationHistoryViolations,
  type SchemaShape,
  schemaBreaksPreviousRelease,
} from "../packages/db/src/migration-compat.js";

// Deploys roll back by image and keep the migrated schema, so a release's migrations must
// leave a schema the previous release still works with. This applies the base revision's
// migrations (main, or the PR base) and then this revision's new ones on a disposable
// loopback PostgreSQL, compares both catalogs and refuses what the previous release could
// no longer read or write. It never reads a developer or production DATABASE_URL.
//
// Not covered: CHECK/unique constraints and triggers that reject old writes, and data the
// migration rewrites. Those still need review; a contract migration is marked with
// CONTRACT_MIGRATION_MARKER and ships only after the release that stopped using the object.

const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const root = git(["rev-parse", "--show-toplevel"]).trim();
const relative = "src/agent/packages/db/prisma/migrations";
const directory = path.join(root, relative);
// Every migration folder, including the early 0001_ and suffixed ones such as
// 20260828090002a_; Prisma applies them in name order.
const named = (name: string) => /^\d/.test(name);

function baseRevision(): string {
  // --replay-latest checks the newest migration already on this branch against the schema
  // before it, so a change to this check itself runs the whole path on real migrations.
  if (process.argv.includes("--replay-latest")) {
    const latest = git(["log", "-n", "1", "--diff-filter=A", "--format=%H", "--", `${relative}/*/migration.sql`]).trim();
    return git(["rev-parse", "--verify", `${latest}^`]).trim();
  }
  const requested = process.env.CI_BASE_SHA || process.argv[2];
  if (requested) return git(["rev-parse", "--verify", `${requested}^{commit}`]).trim();
  return git(["merge-base", "origin/main", "HEAD"]).trim();
}

const base = baseRevision();
const baseNames = git(["-C", root, "ls-tree", "--name-only", base, "--", `${relative}/`])
  .split("\n")
  .map((line) => path.posix.basename(line.trim()))
  .filter(named)
  .sort();
const headNames = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && named(entry.name))
  .map((entry) => entry.name)
  .sort();
const changed = [
  ...new Set(
    git(["diff", "--name-only", base, "--", relative])
      .split("\n")
      .filter(Boolean)
      .map((file) => file.slice(relative.length + 1).split("/")[0]!)
      .filter((name) => baseNames.includes(name)),
  ),
];

const history = migrationHistoryViolations({ base: baseNames, head: headNames, changed });
if (history.length) {
  console.error(`FAIL: migration history (base ${base.slice(0, 12)}):\n- ${history.join("\n- ")}`);
  process.exit(1);
}
const added = headNames.filter((name) => !baseNames.includes(name));
if (!added.length) {
  console.log(`PASS: no new migrations since ${base.slice(0, 12)}; applied history unchanged`);
  process.exit(0);
}

const socket = createServer();
await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
const port = (socket.address() as { port: number }).port;
await new Promise<void>((resolve) => socket.close(() => resolve()));
const scratch = await mkdtemp(path.join(tmpdir(), "mycellios-migration-compat-"));
const password = randomBytes(24).toString("hex");
const database = new EmbeddedPostgres({
  databaseDir: path.join(scratch, "pg"),
  port,
  user: "postgres",
  password,
  persistent: false,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: () => {},
});

async function snapshot(sql: ReturnType<EmbeddedPostgres["getPgClient"]>): Promise<SchemaShape> {
  const columns = await sql.query<{
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
    is_identity: string;
    is_generated: string;
  }>(`SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
            c.column_default, c.is_identity, c.is_generated
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE t.table_type = 'BASE TABLE'
        AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
        AND c.table_schema NOT LIKE 'pg_toast%'
        AND c.table_name <> '_prisma_migrations'`);
  const enums = await sql.query<{ name: string; labels: string[] }>(
    `SELECT n.nspname || '.' || t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
       FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
      GROUP BY n.nspname, t.typname`,
  );
  return {
    columns: columns.rows.map((row) => ({
      table: `${row.table_schema}.${row.table_name}`,
      column: row.column_name,
      type: `${row.data_type}:${row.udt_name}`,
      nullable: row.is_nullable === "YES",
      filled: row.column_default !== null || row.is_identity === "YES" || row.is_generated === "ALWAYS",
    })),
    enums: enums.rows,
  };
}

try {
  await database.initialise();
  await database.start();
  const sql = database.getPgClient();
  await sql.connect();
  try {
    // Prisma runs each migration.sql as one script, in folder order; so does this.
    for (const name of baseNames) {
      try {
        await sql.query(git(["show", `${base}:${relative}/${name}/migration.sql`]));
      } catch (error) {
        throw new Error(`base migration ${name} failed: ${(error as Error).message}`);
      }
    }
    const before = await snapshot(sql);
    let contract = false;
    for (const name of added) {
      const text = await readFile(path.join(directory, name, "migration.sql"), "utf8");
      contract ||= isContractMigration(text);
      try {
        await sql.query(text);
      } catch (error) {
        throw new Error(`new migration ${name} failed on main's schema: ${(error as Error).message}`);
      }
    }
    const after = await snapshot(sql);
    const violations = schemaBreaksPreviousRelease(before, after);
    const blocking = blockingViolations(violations, contract);
    for (const violation of violations)
      console.log(`${blocking.includes(violation) ? "BLOCKS" : "contract"} ${violation.kind} ${violation.object}: ${violation.detail}`);
    if (blocking.length) {
      console.error(
        `FAIL: ${added.join(", ")} would break the running release (rollback keeps the migrated schema). ` +
          "Expand first (nullable or defaulted columns, new tables), contract in a later release with the contract marker.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `PASS: ${baseNames.length} base migrations from ${base.slice(0, 12)} then ${added.length} new (${added.join(", ")}) applied on isolated PostgreSQL; ` +
          `${contract ? "contract migration, only drops reported" : "the previous release's schema is intact"}`,
      );
    }
  } finally {
    await sql.end();
  }
} finally {
  await database.stop();
}
