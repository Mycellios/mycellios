import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gateway, publicStatus, targetUrl } from './gateway.mjs';
test('gateway validates the enrolled network instead of trusting requested suffix', () => {
  assert.equal(publicStatus({ BackendState: 'Running', CurrentTailnet: { MagicDNSSuffix: 'other.ts.net' } }, 'tail123.ts.net').status, 'wrong_tailnet');
  assert.equal(publicStatus({ BackendState: 'Running', CurrentTailnet: { MagicDNSSuffix: 'tail123.ts.net' } }, 'tail123.ts.net').status, 'connected');
  assert.equal(publicStatus({ AuthURL: 'https://attacker.test/login' }, 'tail123.ts.net').authUrl, null);
});
test('gateway rejects DNS suffix tricks and metadata/IP destinations', () => {
  for (const url of ['http://169.254.169.254/', 'http://127.0.0.1/', 'https://mcp.other.ts.net/', 'https://mcp.tail123.ts.net.evil.test/', 'https://mcp.tail123.ts.net/#'])
    assert.throws(() => targetUrl(url, 'tail123.ts.net'));
  assert.equal(targetUrl('https://mcp.tail123.ts.net:8443/mcp', 'tail123.ts.net').port, '8443');
});
test('private gateway authenticates control and streams an MCP response', async () => {
  const key = 'x'.repeat(32), id = 'a'.repeat(24);
  let calls = 0;
  const server = gateway({
    async request(nodeId, suffix, input) {
      calls++; assert.equal(nodeId, id); assert.equal(suffix, 'tail123.ts.net');
      assert.equal(input.url, 'https://mcp.tail123.ts.net/mcp');
      return new Response('data: {"jsonrpc":"2.0"}\n\n', { headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session' } });
    },
  }, key);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/nodes/${id}/fetch`;
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal(calls, 0);
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}` },
      body: JSON.stringify({ dnsSuffix: 'tail123.ts.net', method: 'POST', url: 'https://mcp.tail123.ts.net/mcp' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('mcp-session-id'), 'session');
    assert.match(await response.text(), /jsonrpc/); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
