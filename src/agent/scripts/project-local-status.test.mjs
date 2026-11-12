import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectLocalStatus } from './project-local-status.mjs';

test('requires the dev renderer and both readiness endpoints', async () => {
  const calls = [];
  const result = await projectLocalStatus(async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    if (url.endsWith('/ready')) return Response.json({ ok: true, degraded: false });
    return new Response('/@vite/client vite:beforeUpdate register');
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.every(url => url.startsWith('http://127.0.0.1:')));
});

test('an HTML fallback or production page does not qualify hot reload', async () => {
  const result = await projectLocalStatus(async () => new Response('<html>Mycellios</html>'));
  assert.equal(result.ok, false);
  assert.ok(result.checks.every(check => !check.ok));
});

test('reports a degraded API and an unavailable worker without throwing', async () => {
  const result = await projectLocalStatus(async url => {
    if (url.includes(':3101')) throw new Error('unavailable');
    if (url.includes(':3100')) return Response.json({ ok: true, degraded: true });
    return new Response('/@vite/client vite:beforeUpdate register');
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.find(check => check.service === 'api').ok, false);
  assert.equal(result.checks.find(check => check.service === 'worker').ok, false);
  assert.equal(result.checks.find(check => check.service === 'hmr').ok, true);
});
