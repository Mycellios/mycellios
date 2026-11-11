import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
const name = 'mycellios-referrals-test-' + randomBytes(6).toString('hex');
const password = randomBytes(24).toString('hex');
let owned = false;
let cluster, pgBin;
let code = 1;
try {
  let url = process.env.MYCELLIOS_REFERRAL_TEST_POSTGRES_URL;
  if (!url && spawnSync('pg_config', ['--bindir'], { stdio: 'ignore' }).status === 0 && process.getuid?.() === 0) {
    // CI containers have no Docker socket. A temporary loopback-only cluster stays
    // within the scheduler's memory/process boundary and disappears with the job.
    pgBin = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
    cluster = mkdtempSync(join(tmpdir(), 'mycellios-referrals-pg-'));
    execFileSync('chown', ['postgres:postgres', cluster]);
    const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve));
    execFileSync('runuser', ['-u', 'postgres', '--', join(pgBin, 'initdb'), '-D', cluster, '--auth=trust', '--no-locale'], { stdio: 'ignore' });
    execFileSync('runuser', ['-u', 'postgres', '--', join(pgBin, 'pg_ctl'), '-D', cluster, '-l', join(cluster, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${cluster}`, '-w', 'start'], { stdio: 'ignore' });
    url = `postgresql://postgres@127.0.0.1:${port}/postgres`;
    console.log('Using isolated PostgreSQL ' + execFileSync(join(pgBin, 'postgres'), ['--version'], { encoding: 'utf8' }).trim());
  } else if (!url) {
    execFileSync('docker', ['run', '-d', '--rm', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-p', '127.0.0.1::5432', 'postgres:16-alpine'], { stdio: ['ignore', 'ignore', 'inherit'] });
    owned = true;
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
    const mapping = execFileSync('docker', ['port', name, '5432/tcp'], { encoding: 'utf8' }).trim();
    const port = mapping.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
    if (!port) throw new Error('Unexpected PostgreSQL port mapping');
    url = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  }
  code = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/referrals.postgres.test.ts', '--maxWorkers=1'], {
    stdio: 'inherit', env: { ...process.env, MYCELLIOS_REFERRAL_TEST_POSTGRES_URL: url },
  }).status ?? 1;
} finally {
  if (owned) execFileSync('docker', ['stop', name], { stdio: 'ignore' });
  if (cluster) {
    try { execFileSync('runuser', ['-u', 'postgres', '--', join(pgBin, 'pg_ctl'), '-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' }); }
    finally { rmSync(cluster, { recursive: true, force: true }); }
  }
}
process.exitCode = code;
