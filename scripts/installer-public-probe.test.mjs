import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublicInstallerRange } from './installer-public-probe.mjs';

const file = { path: '/downloads/desktop/releases/0.3.50/installer.dmg', bytes: 4096 };
const partial = (size = 1024, range = 'bytes 0-1023/4096') => new Response(new Uint8Array(size), { status: 206, headers: { 'content-range': range } });

test('cold full responses are closed before retrying the exact partial download', async () => {
  let cancelled = 0, calls = 0; const waits = [];
  const full = new Response(new ReadableStream({ cancel() { cancelled++; } }));
  await verifyPublicInstallerRange(file, { fetchImpl: async (url, options) => {
    assert.equal(url, 'https://www.mycellios.com' + file.path);
    assert.equal(options.headers.Range, 'bytes=0-1023');
    return calls++ === 0 ? full : partial();
  }, sleep: async ms => waits.push(ms) });
  assert.equal(cancelled, 1); assert.equal(calls, 2); assert.deepEqual(waits, [1000]);
});

test('repeated full responses fail after three bounded attempts without consuming installers', async () => {
  let calls = 0, cancelled = 0; const waits = [];
  await assert.rejects(verifyPublicInstallerRange(file, { fetchImpl: async () => {
    calls++; return new Response(new ReadableStream({ cancel() { cancelled++; } }));
  }, sleep: async ms => waits.push(ms) }), /after 3 attempts/);
  assert.equal(calls, 3); assert.equal(cancelled, 3); assert.deepEqual(waits, [1000, 1000]);
});

test('wrong ranges, denied downloads, truncated or oversized partials remain hard failures', async () => {
  for (const response of [partial(1024, 'bytes 0-1023/8192'), new Response('', { status: 403 }), partial(1023), partial(1025)]) {
    let calls = 0;
    await assert.rejects(verifyPublicInstallerRange(file, { fetchImpl: async () => { calls++; return response; } }));
    assert.equal(calls, 1);
  }
});

test('untrusted routes are rejected before making a request', async () => {
  await assert.rejects(verifyPublicInstallerRange({ ...file, path: 'https://elsewhere.invalid/file' }, { fetchImpl: () => assert.fail('must not fetch') }));
});
