// Isolated SDK contract check. No seller, wallet, external network or inference.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import plugin, { JEV_HTTP_TIMEOUT_MS } from './antseed-jev-provider.mjs';

let calls = 0, finishSlow;
const slow = new Promise(resolve => { finishSlow = resolve; });
const server = createServer((request, response) => {
  void (async () => {
    assert.equal(request.headers.authorization, 'Bearer isolated-test-key');
    assert.equal(request.url, '/v1/chat/completions');
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks)); assert.equal(value.model, 'jev'); calls++;
    if (value.testSlow) await slow;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"result":"test-only"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 55, completion_tokens: 0, total_tokens: 55 } }));
  })().catch(() => { response.statusCode = 500; response.end(); });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const provider = plugin.createProvider({ MYCELLIOS_API_KEY: 'isolated-test-key',
    MYCELLIOS_BASE_URL: `http://127.0.0.1:${server.address().port}` });
  await provider.init();
  assert.deepEqual(provider.services, ['jev']); assert.equal(provider.maxConcurrency, 1);
  assert.deepEqual(provider.pricing.defaults, { inputUsdPerMillion: 0, outputUsdPerMillion: 0, cachedInputUsdPerMillion: 0 });
  assert.equal(JEV_HTTP_TIMEOUT_MS, 555000);
  const request = (id, extra = {}) => ({ requestId: id, method: 'POST', path: '/v1/chat/completions',
    headers: { 'content-type': 'application/json' }, body: new TextEncoder().encode(JSON.stringify({ model: 'jev', ...extra })) });
  const result = await provider.handleRequest(request('jev-provider-smoke'));
  assert.equal(result.statusCode, 200);
  assert.equal(JSON.parse(new TextDecoder().decode(result.body)).usage.completion_tokens, 0);
  const denied = await provider.handleRequest(request('other-service', { model: 'not-jev' }));
  assert.equal(denied.statusCode, 403); assert.equal(calls, 1);
  const pending = provider.handleRequest(request('slow-test', { testSlow: true }));
  const until = Date.now() + 2000;
  while (calls < 2) { if (Date.now() > until) throw new Error('synthetic_request_not_started'); await new Promise(resolve => setTimeout(resolve, 5)); }
  const busy = await provider.handleRequest(request('busy-test')); assert.equal(busy.statusCode, 429);
  finishSlow(); assert.equal((await pending).statusCode, 200);
  for (const url of ['https://evil.example', 'http://www.mycellios.com', 'https://www.mycellios.com/?token=x']) {
    assert.throws(() => plugin.createProvider({ MYCELLIOS_API_KEY: 'isolated-test-key', MYCELLIOS_BASE_URL: url }));
  }
  console.log(JSON.stringify({ scope: 'isolated-antseed-provider-sdk-only', passed: true,
    freePriceConfigured: true, syntheticRequests: calls, realModelExecuted: false, sellerAnnounced: false, servedFreeVerified: false }));
} finally { finishSlow(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
