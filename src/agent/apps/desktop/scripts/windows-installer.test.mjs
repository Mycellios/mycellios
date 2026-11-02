import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareWindowsInstaller } from './windows-installer.mjs';

test('bundles the verified runtime without accounts or shared-node uninstall actions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mycellios-installer-'));
  try {
    const runtimeMsi = path.join(root, 'runtime.msi'); const bytes = Buffer.from('fixture');
    await writeFile(runtimeMsi, bytes);
    const runtimeSha256 = createHash('sha256').update(bytes).digest('hex');
    const config = await prepareWindowsInstaller({ desktopRoot: root, runtimeMsi, runtimeSha256, output: path.join(root, 'out'), version: '0.3.5', development: {source: path.join(root,'source'),npm: path.join(root,'npm')} });
    assert.equal(config.appId, 'com.mycellios.agent.desktop');
    assert.equal(config.nsis.deleteAppDataOnUninstall, false);
    assert.equal(config.beforePack, path.join(root,'scripts/verify-release.cjs'));
    assert.equal(config.extraResources.some(x=>x.to==='local-server'),true);
    assert.deepEqual(config.publish, []);
    assert.equal(config.extraResources.some(r=>r.to==='development-source'),true);
    assert.equal(config.extraResources.some(r=>r.to==='development-tools/npm'),true);
    assert.equal(config.win.verifyUpdateCodeSignature, true);
    assert.equal(config.extraResources.some(x => x.to === 'contribution/mycellios-runtime.msi'), true);
    assert.equal(JSON.parse(await readFile(path.join(root, 'out/runtime.json'))).sha256, runtimeSha256);
    const text = JSON.stringify(config);
    assert.equal(/enrollmentToken|apiKey|password|\.env/.test(text), false);
    await assert.rejects(prepareWindowsInstaller({ desktopRoot: root, runtimeMsi, runtimeSha256: '0'.repeat(64), output: path.join(root, 'out'), version: '0.3.5' }), /hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

