import assert from 'node:assert/strict';
import test from 'node:test';
import { DDL, misplacedDdl } from './verify-ddl-locations.mjs';

const config = { schemaPaths: ['src/storage/', 'src/coordinator/node-auto-update.ts'], ignoredPaths: ['tests/'] };

test('recognises schema statements, not prose about them', () => {
  for (const sql of ['CREATE TABLE IF NOT EXISTS jobs (id text)', 'alter table jobs add column x int', 'CREATE UNIQUE INDEX a ON b(c)', 'create or replace function f()', 'DROP TYPE status'])
    assert.ok(DDL.test(sql), sql);
  for (const text of ['create a table of results', 'the index is created later', 'altering the plan']) assert.ok(!DDL.test(text), text);
});

test('reports DDL only outside schema and ignored paths', () => {
  const files = {
    'src/storage/database.ts': 'CREATE TABLE a (id int)',
    'src/coordinator/node-auto-update.ts': 'ALTER TABLE b ADD COLUMN c int',
    'src/coordinator/node-auto-update-extra.ts': 'ALTER TABLE b ADD COLUMN c int',
    'src/coordinator/jobs.ts': 'const sql = `CREATE INDEX jobs_by_state ON jobs (state)`',
    'tests/fixture.test.ts': 'CREATE TABLE t (id int)',
    'docs/notes.md': 'CREATE TABLE in docs',
    'src/coordinator/plain.ts': 'export const x = 1',
  };
  assert.deepEqual(misplacedDdl(Object.keys(files), file => files[file], config), [
    'src/coordinator/jobs.ts',
    'src/coordinator/node-auto-update-extra.ts',
  ]);
});
