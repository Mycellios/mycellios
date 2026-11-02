import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareLinuxInstaller } from './linux-installer.mjs';

test('Linux packages share the app identity and bundle only a verified runtime, with licenses', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mycellios-linux-'));
  try {
    const runtimeDeb = path.join(root, 'runtime.deb'); const bytes = Buffer.from('not a real runtime; packaging fixture');
    await mkdir(path.join(root, 'scripts')); await writeFile(path.join(root, 'scripts/install-runtime.sh'), '#!/bin/sh\nexit 0\n');
    await writeFile(path.join(root, 'scripts/describe-runtime.sh'), '#!/bin/sh\nexit 0\n');
    await writeFile(runtimeDeb, bytes);
    const runtimeSha256 = createHash('sha256').update(bytes).digest('hex');
    const config = await prepareLinuxInstaller({ desktopRoot: root, runtimeDeb, runtimeSha256, output: path.join(root, 'out'), version: '0.3.9', development: {source: path.join(root,'source'),npm: path.join(root,'npm')} });
    assert.equal(config.appId, 'com.mycellios.agent.desktop');
    assert.deepEqual(config.linux.target.map(t => t.target), ['AppImage', 'deb']);
    assert.deepEqual(config.publish, []);
    assert.equal(config.extraResources.some(r=>r.to==='development-source'),true);
    assert.equal(config.extraResources.some(r=>r.to==='development-tools/npm'),true);
    assert.equal(config.extraResources.some(r => r.to === 'contribution/mycellios-runtime.deb'), true);
    assert.equal(config.extraResources.filter(r => r.to.startsWith('licenses/')).length, 3);
    assert.equal(/apiKey|enrollmentToken|--no-sandbox/.test(JSON.stringify(config)), false);
    assert.equal(JSON.parse(await readFile(path.join(root, 'out/runtime.json'))).sha256, runtimeSha256);
    await assert.rejects(prepareLinuxInstaller({ desktopRoot: root, runtimeDeb, runtimeSha256: '0'.repeat(64), output: path.join(root, 'out'), version: '0.3.9' }), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

