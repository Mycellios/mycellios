import { pathToFileURL } from 'node:url';

// Read-only: no installs, builds, restarts, database access or process adoption.
const probes = [
  ['web', 'http://127.0.0.1:5192/', async r => r.ok && (await r.text()).includes('/@vite/client')],
  ['hmr', 'http://127.0.0.1:5192/@vite/client', async r => r.ok && (await r.text()).includes('vite:beforeUpdate')],
  ['reactRefresh', 'http://127.0.0.1:5192/@react-refresh', async r => r.ok && (await r.text()).includes('register')],
  ['api', 'http://127.0.0.1:3100/ready', async r => { const body = await r.json(); return r.ok && body.ok === true && body.degraded !== true; }],
  ['worker', 'http://127.0.0.1:3101/ready', async r => { const body = await r.json(); return r.ok && body.ok === true; }],
];

export async function projectLocalStatus(request = fetch) {
  const start = performance.now();
  const checks = await Promise.all(probes.map(async ([service, url, valid]) => {
    const at = performance.now();
    try {
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(3000), cache: 'no-store' });
      return { service, ok: Boolean(await valid(response)), ms: Math.round(performance.now() - at) };
    } catch {
      return { service, ok: false, ms: Math.round(performance.now() - at) };
    }
  }));
  return { ok: checks.every(check => check.ok), url: 'http://127.0.0.1:5192/app/', ms: Math.round(performance.now() - start), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const status = await projectLocalStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.ok ? 0 : 1;
}
