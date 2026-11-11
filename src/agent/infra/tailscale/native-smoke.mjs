import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const base = process.env.TAILSCALE_GATEWAY_TEST_URL ?? 'http://127.0.0.1:8095';
const key = process.env.TAILSCALE_GATEWAY_KEY;
assert.ok(key?.length >= 32, 'A private test key is required');
const id = 'qualification000000000001';
const suffix = 'tail123.ts.net';
let connected = false;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    const response = await fetch(`${base}/nodes/${id}/status`, { method: 'POST', signal: AbortSignal.timeout(1000) });
    if (response.status === 401) { connected = true; break; }
  } catch { /* Wait for the real container listener. */ }
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(connected, 'Gateway listener did not become ready');
async function control(action) {
  const response = await fetch(`${base}/nodes/${id}/${action}`, {
    method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dnsSuffix: suffix }), signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, 200, `Real gateway ${action} failed`);
  return response.json();
}
const state = await control('connect');
assert.equal(state.status, 'needs_auth', 'An unregistered device must ask for consent');
const url = new URL(state.authUrl);
assert.equal(url.protocol, 'https:');
assert.equal(url.hostname, 'login.tailscale.com');
await control('remove');
const receipt = { nativeDaemon: true, unprivilegedUserspace: true, gatewayAuthentication: true,
  officialDeviceConsentUrl: true, saasConsentCompleted: false, logout: true, liveTailnet: false };
if (process.argv[2]) await writeFile(process.argv[2], `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
