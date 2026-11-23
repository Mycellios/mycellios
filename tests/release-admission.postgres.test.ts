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
  await sql.unsafe(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.jobs(id text primary key,status text,deadline_at bigint); CREATE TABLE ${schema}.deployment_operations(id text,status text); CREATE TABLE ${schema}.api_usage(status text); CREATE TABLE ${schema}.economic_credit_holds(status text)`);
  await sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('active','streaming')`);
});
afterAll(async () => { if (enabled) { await sql.unsafe(`DROP SCHEMA ${schema} CASCADE`); await sql.end(); } });
it.skipIf(!enabled)("closes every insert while letting existing work finish and preserves revision ownership", async () => {
  const gate = new NativeReleaseAdmission(sql, schema);
  await gate.close(revision);
  await expect(sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('new','queued')`)).rejects.toMatchObject({ code: "55000" });
  await expect(sql.unsafe(`INSERT INTO ${schema}.deployment_operations VALUES('new-operation','running')`)).rejects.toMatchObject({ code: "55000" });
  await sql.begin(async tx => {
    await tx`SELECT set_config('mycellios.release_admission_revision', ${revision}, true)`;
    await tx.unsafe(`INSERT INTO ${schema}.jobs VALUES('operator-qualification','completed')`);
  });
  await expect(sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('no-inherited-permit','queued')`)).rejects.toMatchObject({ code: "55000" });
  expect((await gate.status(revision)).drained).toBe(false);
  await sql.unsafe(`UPDATE ${schema}.jobs SET status='completed' WHERE id='active'`);
  expect((await gate.status(revision)).drained).toBe(true);
  await expect(gate.open("b".repeat(40))).rejects.toThrow("different release");
  await gate.open(revision);
  await sql.unsafe(`INSERT INTO ${schema}.jobs VALUES('after','queued')`);
  expect((await sql.unsafe(`SELECT id FROM ${schema}.jobs WHERE id='after'`)).length).toBe(1);
});

it.skipIf(!enabled)("transfers admission without a gap in the barrier or disrupting work already admitted", async () => {
  const gate = new NativeReleaseAdmission(sql, schema);
  const next = "b".repeat(40);
  const insert = (revision: string, statement: string) => sql.begin(async tx => {
    await tx`SELECT set_config('mycellios.release_admission_revision', ${revision}, true)`;
    await tx.unsafe(statement);
  });
  await expect(gate.transfer(revision, next)).rejects.toThrow("expected release");
  await gate.close(revision);
  await insert(revision, `INSERT INTO ${schema}.jobs VALUES('inflight-release','streaming',1720000000000)`);
  const before = (await gate.status(revision)).active;
  await expect(gate.transfer("c".repeat(40), next)).rejects.toThrow("expected release");
  await sql.unsafe(`ALTER TABLE ${schema}.jobs DISABLE TRIGGER mycellios_release_admission_guard`);
  await expect(gate.transfer(revision, next)).rejects.toThrow("different release");
  await sql.unsafe(`ALTER TABLE ${schema}.jobs ENABLE TRIGGER mycellios_release_admission_guard`);
  await gate.transfer(revision, next);
  await gate.transfer(revision, next);
  for (const table of ["jobs", "deployment_operations"]) {
    await expect(insert(revision, `INSERT INTO ${schema}.${table} VALUES('old-denied','running')`))
      .rejects.toMatchObject({ code: "55000" });
  }
  expect((await gate.status(next)).active).toBe(before);
  expect(await sql.unsafe(`SELECT status, deadline_at::text FROM ${schema}.jobs WHERE id='inflight-release'`))
    .toEqual([{ status: "streaming", deadline_at: "1720000000000" }]);
  await insert(revision, `UPDATE ${schema}.jobs SET status='completed' WHERE id='inflight-release'`);
  await insert(next, `INSERT INTO ${schema}.jobs VALUES('new-admitted','completed')`);
  await gate.transfer(next, revision);
  await expect(insert(next, `INSERT INTO ${schema}.jobs VALUES('candidate-denied','queued')`))
    .rejects.toMatchObject({ code: "55000" });
  await gate.open(revision);
});
