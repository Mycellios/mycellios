import { describe, expect, it } from "vitest";
import {
  blockingViolations,
  type ColumnShape,
  CONTRACT_MIGRATION_MARKER,
  isContractMigration,
  migrationHistoryViolations,
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
