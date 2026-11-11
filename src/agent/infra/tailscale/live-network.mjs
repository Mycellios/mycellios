// Ephemeral encrypted Tailscale network with a Headscale controller. This proves
// private transport, not the separate Tailscale SaaS browser-consent workflow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const docker = (...args) => {
  try { return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (error) { throw new Error(`Docker qualification command failed: ${error.stderr?.toString().slice(-1800)}`); }
};
const pause = ms => new Promise(r => setTimeout(r, ms));
const dir = resolve('build/tailscale-gateway/live');
mkdirSync(dir, { recursive: true });
const suffix = 'qualification.ts.net';
const id = 'qualificationnetwork0001';
const control = async action => {
  const response = await fetch(`http://127.0.0.1:8095/nodes/${id}/${action}`, { method: 'POST',
    headers: { authorization: `Bearer ${process.env.TAILSCALE_GATEWAY_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ dnsSuffix: suffix }) });
  assert.equal(response.status, 200);
  return response.json();
};
writeFileSync(`${dir}/config.yaml`, `server_url: http://tailnet-control:8080
listen_addr: 0.0.0.0:8080
noise:
  private_key_path: /var/lib/headscale/noise.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
derp:
  urls: [https://controlplane.tailscale.com/derpmap/default]
dns:
  magic_dns: true
  base_domain: ${suffix}
  nameservers:
    global: [1.1.1.1]
log:
  level: warn
`);
try {
  docker('network', 'create', 'tailnet-qualification');
  docker('network', 'connect', 'tailnet-qualification', 'tailscale-qualification');
  docker('run', '-d', '--name', 'tailnet-control', '--network', 'tailnet-qualification',
    '-v', `${dir}/config.yaml:/etc/headscale/config.yaml:ro`, 'headscale/headscale:0.29.6', 'serve');
  let user;
  for (let n = 0; n < 30; n++) {
    try { user = JSON.parse(docker('exec', 'tailnet-control', 'headscale', 'users', 'create', 'qualification', '--output', 'json')); break; }
    catch { await pause(1000); }
  }
  assert.ok(user?.id, 'Headscale started and created test identity');
  const key = JSON.parse(docker('exec', 'tailnet-control', 'headscale', 'preauthkeys', 'create', '--user', String(user.id), '--reusable', '--expiration', '30m', '--output', 'json'));
  // docker cp retains the runner UID, which differs from the unprivileged image
  // UID. This short-lived test-only key must be readable there without granting
  // either container CHOWN/FOWNER capabilities. Never log or upload this file.
  writeFileSync(`${dir}/authkey`, key.key, { mode: 0o644 });
  docker('run', '-d', '--name', 'tailnet-peer', '--network', 'tailnet-qualification', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--entrypoint', 'sh',
    '-v', `${resolve('src/agent/infra/tailscale/private-mcp-fixture.mjs')}:/fixture.mjs:ro`,
    'mycellios-tailscale:qualification', '-c',
    'node /fixture.mjs & exec tailscaled --tun=userspace-networking --socket=/tmp/peer.sock --statedir=/tmp/ts --port=0');
  await pause(2000);
  docker('cp', `${dir}/authkey`, 'tailnet-peer:/tmp/authkey');
  docker('exec', 'tailnet-peer', 'tailscale', '--socket=/tmp/peer.sock', 'up', '--login-server=http://tailnet-control:8080', '--auth-key=file:/tmp/authkey', '--hostname=private-mcp', '--accept-dns=false', '--accept-routes=false', '--timeout=30s');
  docker('exec', 'tailnet-peer', 'tailscale', '--socket=/tmp/peer.sock', 'serve', '--bg', '--http=8080', 'http://127.0.0.1:8081');
  await control('status'); // Create the real gateway daemon without SaaS login.
  docker('cp', `${dir}/authkey`, 'tailscale-qualification:/tmp/authkey');
  docker('exec', 'tailscale-qualification', 'tailscale', `--socket=/state/${id}/tailscaled.sock`, 'up',
    '--login-server=http://tailnet-control:8080', '--auth-key=file:/tmp/authkey', '--hostname=gateway-test',
    '--accept-dns=false', '--accept-routes=false', '--shields-up', '--timeout=30s');
  const status = await control('status');
  assert.equal(status.status, 'connected');
  const peer = JSON.parse(docker('exec', 'tailnet-peer', 'tailscale', '--socket=/tmp/peer.sock', 'status', '--json'));
  assert.equal(peer.BackendState, 'Running');
  assert.equal(peer.CurrentTailnet.MagicDNSSuffix, suffix);
  const endpoint = `http://private-mcp.${suffix}:8080/mcp`;
  await assert.rejects(fetch(endpoint, { signal: AbortSignal.timeout(2000) }), 'MCP is unreachable without tailnet');
  // The actual Prisma + Mico connector harness consumes this running network.
  writeFileSync(`${dir}/network.json`, JSON.stringify({ id, suffix, endpoint, controller: 'Headscale 0.29.6', saasConsentVerified: false }));
  docker('exec', 'tailscale-qualification', 'tailscale', `--socket=/state/${id}/tailscaled.sock`, 'ping', '--c=1', '--timeout=20s', `private-mcp.${suffix}`);
  console.log('PASS: two real userspace Tailscale nodes enrolled; encrypted peer reachability; private MCP has no direct public ingress');
} finally {
  rmSync(`${dir}/authkey`, { force: true });
}
