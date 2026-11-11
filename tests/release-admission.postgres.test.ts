import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { NativeReleaseAdmission } from "../src/coordinator/release-admission.js";
const enabled = Boolean(process.env.MYCELLIOS_RELEASE_TEST_POSTGRES_URL);
const schema = "release_test_" + Math.random().toString(36).slice(2);
let sql: postgres.Sql;
const revision = "a".repeat(40);
beforeAll(async () => {
  if (!enabled) return;
  sql = postgres(process.env.MYCELLIOS_RELEASE_TEST_POSTGRES_URL!, { max: 2, onnotice: () => {} });
  await sql.unsafe(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.jobs(id text primary key,status text); CREATE TABLE ${schema}.deployment_operations(id text,status text); CREATE TABLE ${schema}.api_usage(status text); CREATE TABLE ${schema}.economic_credit_holds(status text)`);
  await sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('active','streaming')`);
});
afterAll(async () => { if (enabled) { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); } });
it.skipIf(!enabled)("closes every insert while letting existing work finish and preserves revision ownership", async () => {
  const gate = new NativeReleaseAdmission(sql, schema);
  await gate.close(revision);
  await expect(sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('new','queued')`)).rejects.toMatchObject({ code: "55000" });
  await expect(sql.unsafe(`INSERT INTO ${schema}.deployment_operations VALUES('new-operation','running')`)).rejects.toMatchObject({ code: "55000" });
  expect((await gate.status(revision)).drained).toBe(false);
  await sql.unsafe(`UPDATE ${schema}.jobs SET status='completed' WHERE id='active'`);
  expect((await gate.status(revision)).drained).toBe(true);
  await expect(gate.open("b".repeat(40))).rejects.toThrow("different release");
  await gate.open(revision);
  await sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('after','queued')`);
  expect((await sql.unsafe(`SELECT id FROM ${schema}.jobs WHERE id='after'`)).length).toBe(1);
});
