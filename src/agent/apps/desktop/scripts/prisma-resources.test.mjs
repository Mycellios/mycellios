import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { stagePrismaResources } from './prisma-resources.mjs';

test('ships complete migrations and leaves unfinished source directories untouched', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'mycellios-migration-package-'));
  try {
    const source = path.join(root,'source');
    for (const name of ['complete','unfinished']) await mkdir(path.join(source,'migrations',name),{recursive:true});
    await writeFile(path.join(source,'schema.prisma'),'fixture schema');
    await writeFile(path.join(source,'migrations/complete/migration.sql'),'SELECT 1;');
    await stagePrismaResources(source,path.join(root,'packaged'));
    assert.deepEqual(await readdir(path.join(root,'packaged/migrations')),['complete']);
    assert.equal(await readFile(path.join(root,'packaged/migrations/complete/migration.sql'),'utf8'),'SELECT 1;');
    assert.deepEqual(await readdir(path.join(source,'migrations/unfinished')),[]);
    await writeFile(path.join(source,'migrations/unfinished/draft.txt'),'not a migration');
    await assert.rejects(stagePrismaResources(source,path.join(root,'invalid')),/missing SQL/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
