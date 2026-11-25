import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ClientBase } from "pg";
import { Client, escapeIdentifier, escapeLiteral } from "pg";

/**
 * Before an install moves to this release's images, the migrations its database records are
 * compared with the ones this release ships (specs/trusted-distribution, phase 1). A database that a
 * newer release of the project Mycellios Agent was imported from migrated lists migrations this
 * repository lacks, and starting this release's API on it could fail on a schema it does not know.
 * Reads only: nothing here applies, marks or removes a migration.
 */

/** The migrations a release ships: each `prisma/migrations/<name>/migration.sql`. */
export async function shippedMigrations(directory: string): Promise<string[]> {
  const names: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = await stat(path.join(directory, entry.name, "migration.sql")).catch(() => null);
    if (file?.isFile()) names.push(entry.name);
  }
  return names.sort();
}

/**
 * The migrations Prisma's history table records as applied or attempted. Rows marked rolled back
 * no longer count, and a database that never ran a migration records none.
 */
export async function recordedMigrations(
  client: Pick<ClientBase, "query">,
  schema?: string,
): Promise<string[]> {
  const table = schema ? `${escapeIdentifier(schema)}._prisma_migrations` : "_prisma_migrations";
  const found = await client.query<{ name: string | null }>(
    `SELECT to_regclass(${escapeLiteral(table)})::text AS name`,
  );
  if (!found.rows[0]?.name) return [];
  const rows = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM ${table} WHERE rolled_back_at IS NULL`,
  );
  return [...new Set(rows.rows.map((row) => row.migration_name))].sort();
}

/** Recorded migrations that the release does not ship, sorted. A move must refuse any of them. */
export function unknownMigrations(
  recorded: readonly string[],
  shipped: readonly string[],
): string[] {
  const known = new Set(shipped);
  return [...new Set(recorded.filter((name) => !known.has(name)))].sort();
}

/**
 * Connects with `url` (the migration owner, which can read the history table), honouring Prisma's
 * `schema` parameter, and returns the migrations the database records that `directory` lacks.
 */
export async function databaseMigrationsMissingFrom(
  url: string,
  directory: string,
): Promise<string[]> {
  const shipped = await shippedMigrations(directory);
  if (shipped.length === 0) throw new Error(`No migrations were found in ${directory}.`);
  const schema = new URL(url).searchParams.get("schema") ?? undefined;
  const client = new Client({
    connectionString: url,
    application_name: "mycellios-migration-check",
  });
  await client.connect();
  try {
    return unknownMigrations(await recordedMigrations(client, schema), shipped);
  } finally {
    await client.end();
  }
}
