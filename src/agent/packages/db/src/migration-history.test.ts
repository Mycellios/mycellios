import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordedMigrations, shippedMigrations, unknownMigrations } from "./migration-history.js";

// The real history table and CLI run on isolated PostgreSQL in scripts/verify-migration-history-db.ts.
let directory = "";
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

describe("shippedMigrations", () => {
  it("lists each migration directory that holds a migration.sql, sorted", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "mycellios-migrations-"));
    for (const name of ["20260102000000_second", "0001_init", "20260103000000_empty"]) {
      await mkdir(path.join(directory, name));
    }
    await writeFile(path.join(directory, "20260102000000_second", "migration.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "0001_init", "migration.sql"), "SELECT 1;");
    await writeFile(path.join(directory, "migration_lock.toml"), 'provider = "postgresql"\n');
    expect(await shippedMigrations(directory)).toEqual(["0001_init", "20260102000000_second"]);
  });
});

describe("unknownMigrations", () => {
  it("returns each recorded migration the release lacks once, sorted", () => {
    expect(
      unknownMigrations(
        ["0001_init", "29990102000000_newer", "29990101000000_newer", "29990102000000_newer"],
        ["0001_init", "0002_next"],
      ),
    ).toEqual(["29990101000000_newer", "29990102000000_newer"]);
    expect(unknownMigrations([], ["0001_init"])).toEqual([]);
    // A release that ships more than the database records is an ordinary upgrade.
    expect(unknownMigrations(["0001_init"], ["0001_init", "0002_next"])).toEqual([]);
  });
});

describe("recordedMigrations", () => {
  function client(rows: Record<string, unknown[]>) {
    const queries: string[] = [];
    return {
      queries,
      query: async (text: string) => {
        queries.push(text);
        const key = Object.keys(rows).find((pattern) => text.includes(pattern));
        return { rows: key === undefined ? [] : rows[key] };
      },
    };
  }

  it("records nothing for a database that never ran a migration", async () => {
    const fake = client({ to_regclass: [{ name: null }] });
    expect(await recordedMigrations(fake as never)).toEqual([]);
    expect(fake.queries).toHaveLength(1);
  });

  it("reads rows not marked rolled back, from the schema Prisma was told to use", async () => {
    const fake = client({
      to_regclass: [{ name: '"tenant"._prisma_migrations' }],
      "SELECT migration_name": [
        { migration_name: "0002_next" },
        { migration_name: "0001_init" },
        { migration_name: "0002_next" },
      ],
    });
    expect(await recordedMigrations(fake as never, 'ten"ant')).toEqual(["0001_init", "0002_next"]);
    expect(fake.queries[0]).toContain(`to_regclass('"ten""ant"._prisma_migrations')`);
    expect(fake.queries[1]).toContain(
      'FROM "ten""ant"._prisma_migrations WHERE rolled_back_at IS NULL',
    );
  });
});
