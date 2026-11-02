import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseInputs, writeReleaseReceipt, verifyDesktopRelease } from './release-continuity.mjs';

test('packaging rejects stale sources, changed bundles and a missing build, including version upgrades', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mycellios-release-'));
  try {
    for (const surface of ['desktop', 'web']) await mkdir(path.join(root, 'apps', surface, 'dist'), {recursive:true});
    const metadata = path.join(root, 'apps/desktop/package.json');
    const source = path.join(root, 'apps/desktop/src/host-computer.ts');
    await mkdir(path.dirname(source), {recursive:true});
    await writeFile(metadata, JSON.stringify({version:'0.3.9'}));
    await writeFile(source, 'current native grant implementation');
    await writeFile(path.join(root, 'apps/desktop/dist/main.js'), 'native bundle');
    await writeFile(path.join(root, 'apps/web/dist/index.html'), 'current renderer');
    await mkdir(path.join(root, 'apps/web/dist/first-party'), {recursive:true});
    await writeFile(path.join(root, 'apps/web/dist/first-party/index.html'), '<script src="/agent/assets/current.js"></script>');
    await mkdir(path.join(root, 'apps/desktop/local-server/dist'), {recursive:true});
    await writeFile(path.join(root, 'apps/desktop/local-server/dist/desktop-local-entry.js'), 'local server');
    const desktop = path.join(root, 'apps/desktop');
    const build = async () => {
      const inputs = await releaseInputs(root);
      for (const surface of ['desktop', 'web', 'local-server']) await writeReleaseReceipt(root, surface, inputs);
      await verifyDesktopRelease(desktop);
    };
    await assert.rejects(verifyDesktopRelease(desktop), /Missing desktop/);
    await build();
    const { default: beforePack } = await import('./verify-release.cjs');
    await beforePack({packager:{info:{appDir:desktop}}});
    await writeFile(source, 'new implementation');
    await assert.rejects(verifyDesktopRelease(desktop), /Stale desktop/);
    await build();
    await writeFile(path.join(root, 'apps/web/dist/index.html'), 'old copied renderer');
    await assert.rejects(verifyDesktopRelease(desktop), /Modified web/);
    await build();
    const before = await releaseInputs(root);
    await writeFile(metadata, JSON.stringify({version:'0.3.10'}));
    await assert.rejects(writeReleaseReceipt(root, 'desktop', before), /Source changed during build/);
    await assert.rejects(verifyDesktopRelease(desktop), /Stale desktop/);
    await build();
    assert.equal(JSON.parse(await readFile(path.join(root, 'apps/desktop/dist/release-inputs.json'), 'utf8')).version, '0.3.10');
    await rm(path.join(root, 'apps/web/dist/release-inputs.json'));
    await assert.rejects(verifyDesktopRelease(desktop), /Missing web/);
  } finally { await rm(root, {recursive:true,force:true}); }
});
