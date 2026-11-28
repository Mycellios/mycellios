/**
 * Whether a release's migrations leave a schema the previous release can still use.
 *
 * Deploys roll back by image only: the schema stays migrated. So every migration must be
 * additive for the code that is running when it is applied (expand first, contract in a later
 * release). scripts/verify-migration-compat-db.ts applies main's migrations and then the new
 * ones on a disposable PostgreSQL, reads both catalogs and passes them here.
 */

/** A column as the catalog reports it. `type` joins data_type and udt_name. */
export type ColumnShape = {
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  /** A default, identity or generated value: an insert that omits the column still works. */
  filled: boolean;
};

export type SchemaShape = {
  columns: ColumnShape[];
  enums: { name: string; labels: string[] }[];
};

export type CompatViolationKind =
  | "table_removed"
  | "column_removed"
  | "type_changed"
  | "now_required"
  | "enum_label_removed"
  | "required_without_default";

export type CompatViolation = { kind: CompatViolationKind; object: string; detail: string };

/**
 * A migration may contract (drop or tighten what the previous release no longer reads or
 * writes) only when it says so on its own line. It still may not add a column the previous
 * release would have to fill.
 */
export const CONTRACT_MIGRATION_MARKER = "-- mycellios-migration: contract";

const CONTRACT_ALLOWED: ReadonlySet<CompatViolationKind> = new Set([
  "table_removed",
  "column_removed",
  "type_changed",
  "now_required",
  "enum_label_removed",
]);

export function isContractMigration(sql: string): boolean {
  return sql.split(/\r?\n/).some((line) => line.trim() === CONTRACT_MIGRATION_MARKER);
}

/** What in `head` the previous release (which saw `base`) cannot work with. */
export function schemaBreaksPreviousRelease(base: SchemaShape, head: SchemaShape): CompatViolation[] {
  const violations: CompatViolation[] = [];
  const key = (column: Pick<ColumnShape, "table" | "column">) => `${column.table}.${column.column}`;
  const headColumns = new Map(head.columns.map((column) => [key(column), column]));
  const baseColumns = new Map(base.columns.map((column) => [key(column), column]));
  const headTables = new Set(head.columns.map((column) => column.table));
  const baseTables = new Set(base.columns.map((column) => column.table));

  for (const table of [...baseTables].sort()) {
    if (!headTables.has(table))
      violations.push({ kind: "table_removed", object: table, detail: "the previous release still reads it" });
  }
  for (const [name, before] of [...baseColumns].sort(([a], [b]) => a.localeCompare(b))) {
    if (!headTables.has(before.table)) continue;
    const after = headColumns.get(name);
    if (!after) {
      violations.push({ kind: "column_removed", object: name, detail: "the previous release still reads it" });
      continue;
    }
    if (after.type !== before.type)
      violations.push({ kind: "type_changed", object: name, detail: `${before.type} -> ${after.type}` });
    if (before.nullable && !after.nullable)
      violations.push({ kind: "now_required", object: name, detail: "the previous release may still write null" });
  }
  for (const [name, after] of [...headColumns].sort(([a], [b]) => a.localeCompare(b))) {
    if (baseColumns.has(name) || !baseTables.has(after.table)) continue;
    if (!after.nullable && !after.filled)
      violations.push({
        kind: "required_without_default",
        object: name,
        detail: "the previous release inserts rows without it; add a default or make it nullable",
      });
  }
  const headEnums = new Map(head.enums.map((entry) => [entry.name, new Set(entry.labels)]));
  for (const entry of [...base.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    const labels = headEnums.get(entry.name);
    for (const label of entry.labels) {
      if (!labels?.has(label))
        violations.push({ kind: "enum_label_removed", object: `${entry.name}.${label}`, detail: "the previous release may still write it" });
    }
  }
  return violations;
}

/** Violations a contract migration does not excuse. */
export function blockingViolations(violations: CompatViolation[], contract: boolean): CompatViolation[] {
  return contract ? violations.filter((violation) => !CONTRACT_ALLOWED.has(violation.kind)) : violations;
}

const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

/**
 * Applied migrations are history: Prisma refuses a database whose recorded checksum no longer
 * matches, and a migration ordered before one already applied would be applied out of order.
 */
export function migrationHistoryViolations(input: {
  base: string[];
  head: string[];
  /** Base migration folders whose files differ in head (edited or deleted). */
  changed: string[];
}): string[] {
  const problems: string[] = [];
  const head = new Set(input.head);
  for (const name of input.base) if (!head.has(name)) problems.push(`${name}: removed, but databases already applied it`);
  for (const name of input.changed) if (head.has(name)) problems.push(`${name}: edited, but databases already applied it`);
  const latest = [...input.base].sort().at(-1) ?? "";
  for (const name of input.head) {
    if (input.base.includes(name)) continue;
    if (!MIGRATION_NAME.test(name)) problems.push(`${name}: not a <14-digit timestamp>_<snake_case> folder`);
    else if (name <= latest) problems.push(`${name}: sorts before ${latest}, which is already applied; use a later timestamp`);
  }
  return problems;
}
