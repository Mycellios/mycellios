import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { writeWindowsPayloadBlockmap } from './windows-payload-blockmap.mjs';

test('the standard blockmap describes the EXE without appending to it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'windows-blockmap-'));
  try {
    const file = path.join(root, 'fixture.exe'), bytes = Buffer.from('installer fixture '.repeat(5000));
    await writeFile(file, bytes);
    const metadata = await writeWindowsPayloadBlockmap(file);
    assert.deepEqual(await readFile(file), bytes);
    assert.equal(metadata.sha512, createHash('sha512').update(bytes).digest('base64'));
    const map = JSON.parse(gunzipSync(await readFile(file + '.blockmap')));
    assert.equal(map.version, '2');
    assert.equal(map.files.length, 1);
    assert.equal(map.files[0].sizes.reduce((sum, size) => sum + size, 0), bytes.length);
    assert.equal(map.files[0].checksums.length, map.files[0].sizes.length);
  } finally { await rm(root, { recursive: true, force: true }); }
});
