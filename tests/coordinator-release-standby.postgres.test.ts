import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { expect, it } from "vitest";
import { checkReleaseStandbyDatabase, createReleaseStandby } from "../src/coordinator/release-standby.js";

const url = process.env.MYCELLIOS_RELEASE_TEST_POSTGRES_URL;

it.skipIf(!url)("reads readiness with SELECT privileges while preserving active inference state", async () => {
  const schema = "standby_" + randomBytes(8).toString("hex");
  const role = schema + "_reader";
  const password = randomBytes(20).toString("hex");
  const owner = postgres(url!, { max: 1, onnotice: () => {} });
  const reader = new URL(url!);
  reader.username = role;
  reader.password = password;
  const app = createReleaseStandby("a".repeat(40), () => checkReleaseStandbyDatabase(reader.href, schema));
  try {
    await owner.unsafe(`
      CREATE SCHEMA ${schema};
      CREATE ROLE ${role} LOGIN PASSWORD '${password}';
      CREATE TABLE ${schema}.schema_meta(version integer);
      INSERT INTO ${schema}.schema_meta VALUES (33);
      CREATE TABLE ${schema}.api_operator_funded_usage(usage_id text);
      CREATE TABLE ${schema}.jobs(id text, status text, deadline_at bigint);
      INSERT INTO ${schema}.jobs VALUES ('incumbent', 'streaming', 1720000000000);
      GRANT USAGE ON SCHEMA ${schema} TO ${role};
      GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO ${role};
    `);
    const before = await owner.unsafe(`SELECT * FROM ${schema}.jobs`);
    const ready = await app.inject("/internal/release/standby/ready");
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ releaseState: "standby" });
    expect((await app.inject("/health")).statusCode).toBe(503);
    expect(await owner.unsafe(`SELECT * FROM ${schema}.jobs`)).toEqual(before);
    await owner.unsafe(`UPDATE ${schema}.schema_meta SET version = 1`);
    expect((await app.inject("/internal/release/standby/ready")).statusCode).toBe(503);
    expect(await owner.unsafe(`SELECT * FROM ${schema}.jobs`)).toEqual(before);
  } finally {
    await app.close();
    try {
      await owner.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP ROLE IF EXISTS ${role}`);
    } finally {
      await owner.end();
    }
  }
});
