// Isolated ingress/cancellation test: no seller, wallet or model is started.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createJevPrivateBridge } from './antseed-jev-bridge.mjs';

let calls = 0, retries = 0, releaseHold, markHeld, markCancelled;
const held = new Promise(resolve => { markHeld = resolve; });
const cancelled = new Promise(resolve => { markCancelled = resolve; });
const hold = new Promise(resolve => { releaseHold = resolve; });
const upstream = createServer((req, res) => {
  void (async () => {
    calls++; assert.equal(req.headers.authorization, 'Bearer bridge-test-key');
    assert.equal(req.url, '/v1/chat/completions');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks));
    res.setHeader('content-type', 'application/json');
    if (body.test === 'hold') { res.once('close', markCancelled); markHeld(); await hold; if (!res.destroyed) res.end('{}'); return; }
    if (body.test === 'redirect') { res.writeHead(302, { location: 'http://192.0.2.1' }); res.end(); return; }
    if (body.test === 'other429') { res.statusCode = 429; res.end('{"error":{"code":"rate_limit_exceeded"}}'); return; }
    if (body.test === '503') { res.statusCode = 503; res.end('{"error":{"code":"runtime_failed"}}'); return; }
    if (body.test === 'retry' && retries++ < 2) { res.statusCode = 429; res.end('{"error":{"code":"concurrency_limit_exceeded"}}'); return; }
    res.end('{"usage":{"prompt_tokens":55,"completion_tokens":0},"result":"test-only"}');
  })().catch(() => { if (!res.destroyed) { res.statusCode = 500; res.end(); } });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const bridge = await createJevPrivateBridge({ upstreamOrigin: 'http://127.0.0.1:' + upstream.address().port,
  apiKey: 'bridge-test-key', retryWindowMs: 1000, retryDelayMs: 5 });
const call = (body, extra = {}) => fetch(bridge.url + '/v1/chat/completions', {
  method: 'POST', headers: { authorization: 'Bearer bridge-test-key', 'content-type': 'application/json' },
  body: JSON.stringify({ model: 'jev', ...body }), ...extra,
});
try {
  let response = await call({ test: 'retry' }); assert.equal(response.status, 200);
  assert.equal((await response.json()).usage.completion_tokens, 0); assert.equal(calls, 3);
  for (const [test, status] of [['other429', 429], ['503', 503], ['redirect', 503]]) {
    const before = calls; response = await call({ test }); assert.equal(response.status, status); await response.text(); assert.equal(calls, before + 1);
  }
  const before = calls;
  response = await call({ model: 'not-jev' }); assert.equal(response.status, 403); await response.text();
  response = await call({}, { headers: { authorization: 'Bearer wrong' } }); assert.equal(response.status, 401); await response.text();
  response = await call({ text: 'x'.repeat(65536) }); assert.equal(response.status, 400); await response.text();
  assert.equal(calls, before);
  const controller = new AbortController(); const pending = call({ test: 'hold' }, { signal: controller.signal });
  const rejected = assert.rejects(pending); await held; controller.abort(); await rejected;
  await Promise.race([cancelled, new Promise((_, reject) => setTimeout(() => reject(Error('upstream_not_cancelled')), 3000).unref())]);
  for (const url of ['http://example.com', 'http://192.0.2.1', 'https://10.0.0.1', 'http://u:p@10.0.0.1', 'http://10.0.0.1/?token=x']) {
    assert.throws(() => createJevPrivateBridge({ upstreamOrigin: url, apiKey: 'test' }));
  }
  console.log(JSON.stringify({ passed: true, accountCapsPreserved: true, admissionOnlyRetries: true,
    cancellationForwarded: true, authenticationRequired: true, realModelExecuted: false, sellerAnnounced: false }));
} finally {
  releaseHold(); upstream.closeAllConnections(); await bridge.close(); await new Promise(resolve => upstream.close(resolve));
}
