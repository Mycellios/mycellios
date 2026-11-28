import { describe, expect, it } from "vitest";
import {
  blockingViolations,
  type ColumnShape,
  CONTRACT_MIGRATION_MARKER,
  isContractMigration,
  migrationHistoryViolations,
  rewritesData,
  type SchemaShape,
  schemaBreaksPreviousRelease,
} from "./migration-compat.js";

const column = (table: string, name: string, extra: Partial<ColumnShape> = {}): ColumnShape => ({
  table,
  column: name,
  type: "text:text",
  nullable: true,
  filled: false,
  ...extra,
});
const shape = (columns: ColumnShape[], enums: SchemaShape["enums"] = []): SchemaShape => ({ columns, enums });
const base = shape(
  [column("public.bots", "id", { nullable: false }), column("public.bots", "name"), column("public.runs", "id", { nullable: false })],
  [{ name: "public.RunStatus", labels: ["queued", "done"] }],
);

describe("schemaBreaksPreviousRelease", () => {
  it("accepts additive changes", () => {
    const head = shape(
      [
        ...base.columns,
        column("public.bots", "color"),
        column("public.bots", "kind", { nullable: false, filled: true }),
        column("public.pins", "id", { nullable: false }),
      ],
      [{ name: "public.RunStatus", labels: ["queued", "done", "paused"] }],
    );
    expect(schemaBreaksPreviousRelease(base, head)).toEqual([]);
  });

  it("reports what the previous release can no longer use", () => {
    const head = shape(
      [
        column("public.bots", "id", { nullable: false }),
        column("public.bots", "name", { nullable: false, type: "character varying:varchar" }),
        column("public.bots", "owner", { nullable: false }),
      ],
      [{ name: "public.RunStatus", labels: ["queued"] }],
    );
    expect(schemaBreaksPreviousRelease(base, head).map((v) => `${v.kind} ${v.object}`)).toEqual([
      "table_removed public.runs",
      "type_changed public.bots.name",
      "now_required public.bots.name",
      "required_without_default public.bots.owner",
      "enum_label_removed public.RunStatus.done",
    ]);
  });

  it("lets a marked contract migration drop but never add a required column", () => {
    const head = shape([column("public.bots", "id", { nullable: false }), column("public.bots", "owner", { nullable: false })]);
    const violations = schemaBreaksPreviousRelease(base, head);
    expect(blockingViolations(violations, false)).toHaveLength(violations.length);
    expect(blockingViolations(violations, true).map((v) => v.kind)).toEqual(["required_without_default"]);
  });
});

describe("constraints, unique indexes and triggers", () => {
  it("need the contract marker only on tables the previous release already writes", () => {
    const head: SchemaShape = {
      ...base,
      columns: [...base.columns, column("public.pins", "id", { nullable: false })],
      constraints: [
        { table: "public.bots", name: "bots_name_check", kind: "c" },
        { table: "public.pins", name: "pins_bot_fkey", kind: "f" },
      ],
      uniqueIndexes: [
        { table: "public.runs", name: "runs_one_active" },
        { table: "public.pins", name: "pins_unique" },
      ],
      triggers: [{ table: "public.bots", name: "bots_touch" }],
    };
    const violations = schemaBreaksPreviousRelease(base, head);
    expect(violations.map((v) => `${v.kind} ${v.object}`)).toEqual([
      "constraint_added public.bots.bots_name_check",
      "unique_index_added public.runs.runs_one_active",
      "trigger_added public.bots.bots_touch",
    ]);
    expect(blockingViolations(violations, true)).toEqual([]);
  });

  it("ignores ones that already existed", () => {
    const existing = { ...base, constraints: [{ table: "public.bots", name: "bots_name_check", kind: "c" }] };
    expect(schemaBreaksPreviousRelease(existing, existing)).toEqual([]);
  });
});

describe("row-level security", () => {
  it("needs the contract marker for policy changes and new row security on existing tables", () => {
    const before: SchemaShape = {
      ...base,
      policies: [{ table: "public.bots", name: "bots_owner", definition: "PERMISSIVE | ALL | public | owner" }],
      rowSecurity: [{ table: "public.bots", mode: "enabled" }],
    };
    const after: SchemaShape = {
      ...before,
      columns: [...base.columns, column("public.pins", "id", { nullable: false })],
      policies: [
        { table: "public.bots", name: "bots_owner", definition: "PERMISSIVE | ALL | public | owner AND space" },
        { table: "public.runs", name: "runs_owner", definition: "PERMISSIVE | ALL | public | owner" },
        { table: "public.pins", name: "pins_owner", definition: "PERMISSIVE | ALL | public | owner" },
      ],
      rowSecurity: [
        { table: "public.bots", mode: "enabled" },
        { table: "public.bots", mode: "forced" },
        { table: "public.runs", mode: "enabled" },
        { table: "public.pins", mode: "enabled" },
      ],
    };
    const violations = schemaBreaksPreviousRelease(before, after);
    expect(violations.map((v) => `${v.kind} ${v.object} ${v.detail.split(";")[0]}`)).toEqual([
      "policy_changed public.bots.bots_owner rewritten",
      "policy_changed public.runs.runs_owner added",
      "row_security_enabled public.bots row-level security now forced",
      "row_security_enabled public.runs row-level security now enabled",
    ]);
    expect(blockingViolations(violations, true)).toEqual([]);
    expect(schemaBreaksPreviousRelease(before, before)).toEqual([]);
  });
});

describe("rewritesData", () => {
  it("finds row changes, not keywords inside other statements or comments", () => {
    expect(rewritesData(`UPDATE "bots" SET "kind" = 'mico';`)).toBe(true);
    expect(rewritesData(`CREATE TABLE a (id int);\nDELETE FROM "runs" WHERE false;`)).toBe(true);
    expect(rewritesData(`INSERT INTO "b" ("id") SELECT "id" FROM "a";`)).toBe(true);
    expect(rewritesData(`ALTER TABLE "a" ADD CONSTRAINT f FOREIGN KEY ("b") REFERENCES "b"("id") ON DELETE CASCADE ON UPDATE CASCADE;`)).toBe(false);
    expect(rewritesData(`-- UPDATE "bots" later\nINSERT INTO "settings" ("id") VALUES ('x');`)).toBe(false);
  });
});

describe("isContractMigration", () => {
  it("needs the marker on its own line", () => {
    expect(isContractMigration(`${CONTRACT_MIGRATION_MARKER}\nALTER TABLE "x" DROP COLUMN "y";`)).toBe(true);
    expect(isContractMigration(`ALTER TABLE "x" DROP COLUMN "y"; ${CONTRACT_MIGRATION_MARKER}`)).toBe(false);
  });
});

describe("migrationHistoryViolations", () => {
  const applied = ["20261101000000_init", "20261127100000_run_memory_recall"];

  it("accepts new later migrations", () => {
    expect(migrationHistoryViolations({ base: applied, head: [...applied, "20261128120000_add_pins"], changed: [] })).toEqual([]);
  });

  it("refuses edited, removed, early and badly named migrations", () => {
    expect(
      migrationHistoryViolations({
        base: applied,
        head: [applied[1]!, "20261120000000_backdated", "add-pins"],
        changed: [applied[1]!],
      }),
    ).toEqual([
      "20261101000000_init: removed, but databases already applied it",
      "20261127100000_run_memory_recall: edited, but databases already applied it",
      "20261120000000_backdated: sorts before 20261127100000_run_memory_recall, which is already applied; use a later timestamp",
      "add-pins: not a <14-digit timestamp>_<snake_case> folder",
    ]);
  });
});
