import type { PrismaClient } from "./generated/prisma/client.js";

type RuntimeDataModel = {
  models: Record<
    string,
    {
      dbName?: string | null;
      fields: Array<{ name: string; kind: string; dbName?: string | null }>;
    }
  >;
};

/** Prisma qualifies every query with the adapter's schema, which createDb leaves at its default. */
const CLIENT_SCHEMA = "public";
const LISTED_MISSING = 20;

/** The tables and columns this build's Prisma client reads and writes, by their Postgres names. */
export function clientSchema(prisma: PrismaClient): Map<string, string[]> {
  const models = (prisma as unknown as { _runtimeDataModel?: RuntimeDataModel })._runtimeDataModel
    ?.models;
  if (!models) throw new Error("Prisma runtime data model is unavailable");
  return new Map(
    Object.entries(models).map(([name, model]) => [
      model.dbName ?? name,
      model.fields
        .filter((field) => field.kind !== "object")
        .map((field) => field.dbName ?? field.name),
    ]),
  );
}

/**
 * The tables (`table`) and columns (`table.column`) the client needs that the
 * connected login cannot see: a migration shipped with this build has not been
 * applied, or its grants are missing. information_schema lists only what the
 * login may use, so a table it cannot read counts as missing too.
 */
export async function missingDatabaseSchema(prisma: PrismaClient): Promise<string[]> {
  const expected = clientSchema(prisma);
  const rows = await prisma.$queryRawUnsafe<Array<{ table: string; column: string }>>(
    `SELECT table_name::text AS "table", column_name::text AS "column"
       FROM information_schema.columns
      WHERE table_schema = $1`,
    CLIENT_SCHEMA,
  );
  const present = new Map<string, Set<string>>();
  for (const { table, column } of rows) {
    const columns = present.get(table) ?? new Set<string>();
    columns.add(column);
    present.set(table, columns);
  }
  const missing: string[] = [];
  for (const [table, columns] of expected) {
    const found = present.get(table);
    if (!found) missing.push(table);
    else for (const column of columns) if (!found.has(column)) missing.push(`${table}.${column}`);
  }
  return missing.sort();
}

/**
 * Stops startup when the database lacks a table or column this build uses.
 * Serving anyway answers every request that touches it with a 500 while a
 * constant health check still reports the release healthy, so a deploy that
 * skipped the migrations could never roll back on its own.
 */
export async function assertDatabaseSchemaCurrent(prisma: PrismaClient): Promise<void> {
  const missing = await missingDatabaseSchema(prisma);
  if (!missing.length) return;
  const listed = missing.slice(0, LISTED_MISSING).join(", ");
  const more =
    missing.length > LISTED_MISSING ? ` and ${missing.length - LISTED_MISSING} more` : "";
  throw new Error(
    `The database schema is behind this build (missing ${listed}${more}). Apply this build's migrations with npm run db:deploy (DATABASE_MIGRATION_URL as the owner) before starting it.`,
  );
}
