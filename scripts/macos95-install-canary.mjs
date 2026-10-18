import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { ABI, contributionCommand, verifyCiContracts } from './macos95-ci-contract.mjs';

const [payloadValue, evidenceValue, recipeRevision] = process.argv.slice(2);
const payload = resolve(payloadValue), evidence = resolve(evidenceValue);
const product = '/Library/Application Support/Mycellios/Product';
const data = '/Library/Application Support/Mycellios';
const configFile = join(data, 'Configuration/node.json');
const healthFile = join(data, 'Configuration/state/health.json');
const controlFile = join(data, 'Configuration/state/control.json');
const service = 'system/io.mycellios.node';
const run = promisify(execFile);
const command = async (file, args, options = {}) => await run(file, args, {
  timeout: 180_000, maxBuffer: 8 * 1024**2, ...options,
});
const load = async (file) => JSON.parse(await readFile(file, 'utf8'));
const imported = async (file) => await import(pathToFileURL(join(payload, 'dist', file)));
const report = { schema: 'mycellios-macos95-hosted-installation/1', recipeRevision,
  payloadSourceId: 'sha256:df3c212976012758420b0085c8050ba417d818fc9424b4ec0a7edc1b42719032',
  payloadRevision: '7e8ce6eaf9b0501c0424773ec94c8e4af94bd3c5', version: '0.2.95',
  unsigned: true, notarized: false, physicalMac: false, realRebootTested: false,
  guiPairingTested: false, gpuInferenceTested: false, distributedInferenceTested: false,
  gates: {}, complete: false };
let coordinator, installed = false;
async function save() { await writeFile(join(evidence, 'installation.json'), JSON.stringify(report, null, 2) + '\n'); }
async function waitFor(label, predicate, timeout = 120_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { const value = await predicate(); if (value) return value; } catch {} await delay(1000); }
  throw Error('macos95_gate_timeout:' + label);
}
async function inject(method, url, body, status) {
  const result = await coordinator.app.inject({ method, url,
    headers: { authorization: 'Bearer ephemeral-ci-account' }, ...(body ? { payload: body } : {}) });
  assert.equal(result.statusCode, status, `${url}: ${result.body}`);
  return status === 204 ? null : result.json();
}
try {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64'); assert.equal(process.getuid(), 0);
  assert.match(recipeRevision, /^[a-f0-9]{40}$/);
  report.gates.ciContracts = await verifyCiContracts(payload);
  await assert.rejects(access(product), 'host must start without a previous Mycellios product');
  const pkg = join(payload, 'build/mycellios-node-0.2.95-macos-arm64.pkg');
  await command('/usr/sbin/installer', ['-pkg', pkg, '-target', '/']); installed = true;
  const packageInfo = await command('/usr/sbin/pkgutil', ['--pkg-info', 'io.mycellios.node']);
  assert.match(packageInfo.stdout, /version: 0\.2\.95/);
  const provenance = await load(join(product, 'mycellios-native-build-provenance.json'));
  assert.equal(provenance.sourceId, report.payloadSourceId);
  report.gates.installer = { version: '0.2.95', payloadSourceId: provenance.sourceId };
  const { MYCELLIOS_RUNTIME_ABI } = await imported('update/runtime-compatibility.js');
  assert.equal(MYCELLIOS_RUNTIME_ABI, ABI);
  const { createCoordinator } = await imported('coordinator/server.js');
  const { SupabaseAuthService } = await imported('coordinator/supabase-auth.js');
  const auth = new SupabaseAuthService('https://auth.example.test', 'ephemeral-fixture-only', async (input) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return Response.json({ id: 'ci-macos95', email: 'fixture@example.test' });
    if (url.includes('/rest/v1/network_members')) return Response.json([{ role: 'viewer' }]);
    return new Response(null, { status: 404 });
  });
  coordinator = await createCoordinator({ host: '127.0.0.1', port: 0, databasePath: ':memory:',
    requestTimeoutMs: 10_000, apiAccessEnabled: false, networkToken: randomUUID() },
  { logger: false, supabaseAuthService: auth, engineRuntimeProfileReconciliation: false });
  await coordinator.app.listen({ host: '127.0.0.1', port: 0 });
  const port = coordinator.app.server.address().port;
  const enrollment = await inject('POST', '/v1/nodes/enrollments', {
    schema: 'mycellios-node-enrollment-create/1', accountId: 'ci-macos95',
    requestedBy: { kind: 'account', id: 'ci-macos95', scopes: ['node:identity'] }, expiresInSeconds: 1800 }, 201);
  await inject('POST', `/v1/nodes/enrollments/${enrollment.enrollmentId}/confirm`, null, 204);
  const bundleFile = join(evidence, 'ephemeral-enrollment.json');
  await writeFile(bundleFile, JSON.stringify({ schema: 'mycellios-node-enrollment-bundle/1',
    coordinatorUrl: `http://127.0.0.1:${port}/`, enrollmentId: enrollment.enrollmentId,
    enrollmentToken: enrollment.enrollmentToken, nonce: enrollment.nonce, expiresAt: enrollment.expiresAt }), { mode: 0o600 });
  await command(join(product, 'bin/node'), [join(product, 'app/node/install-main.js'), '--enrollment', bundleFile], { timeout: 300_000 });
  await assert.rejects(access(bundleFile), 'one-use enrollment must be consumed');
  const config = await load(configFile);
  const firstHealth = await waitFor('service ready', async () => { const value = await load(healthFile); return value.state === 'ready' && value; });
  const parent = await command('/bin/ps', ['-o', 'ppid=', '-p', String(firstHealth.pid)]);
  assert.equal(Number(parent.stdout.trim()), 1);
  assert.equal(config.isolation.mode, 'macos-launchd-limits');
  await command('/bin/launchctl', ['print', service]);
  const ownership = coordinator.database.getNodeOwnership('device', config.nodeId);
  assert.equal(ownership.accountId, 'ci-macos95');
  report.gates.launchd = { parentPid: 1, servicePid: firstHealth.pid, isolation: config.isolation.mode,
    scope: 'Genuine launchd parent and configured limits; not a hard-memory-enforcement claim.' };
  report.gates.localEnrollment = { consumed: true, ownerVerified: true, productionUsed: false };
  const nodeSnapshot = await waitFor('runtime ABI handshake snapshot', async () => {
    const result = await inject('GET', '/v1/nodes', null, 200);
    const node = result.data.find((item) => item.nodeId === config.nodeId);
    return node?.connected && node.observed?.runtime?.ready && node;
  });
  assert.equal(nodeSnapshot.observed.runtime.abi, ABI);
  report.gates.runtimeAbi = { expected: ABI, installedConstant: MYCELLIOS_RUNTIME_ABI, observed: nodeSnapshot.observed.runtime.abi };
  for (const type of ['pause', 'resume']) {
    await inject('POST', `/v1/nodes/${config.nodeId}/commands`, contributionCommand(config.nodeId, ownership.generation, type), 202);
    await waitFor(type, async () => (await load(controlFile)).contributionEnabled === (type === 'resume'));
    report.gates[type] = true;
  }
  const identityHash = createHash('sha256').update(await readFile(config.coordinator.identityPath)).digest('hex');
  await command('/bin/launchctl', ['kickstart', '-k', service]);
  const restarted = await waitFor('restart ready', async () => {
    const value = await load(healthFile); return value.state === 'ready' && value.pid !== firstHealth.pid && value;
  });
  assert.equal(createHash('sha256').update(await readFile(config.coordinator.identityPath)).digest('hex'), identityHash);
  await waitFor('reconnected worker', async () => coordinator.store.listWorkers().some((worker) => worker.identityId === config.nodeId && coordinator.hub.isConnected(worker.id)));
  report.gates.serviceRestart = { oldPid: firstHealth.pid, newPid: restarted.pid, identityPersisted: true };
  const canary = await command(join(product, 'runtime/bin/python3'), ['-B', '-m', 'distributed_runtime.installed_stage_canary'],
    { env: { ...process.env, PYTHONPATH: join(product, 'python'), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: '1', MKL_NUM_THREADS: '1' } });
  const marker = canary.stdout.split('\n').find((line) => line.startsWith('MYCELLIOS_INSTALLED_STAGE_CANARY='));
  assert.ok(marker, 'real installed tiny CPU canary evidence missing');
  report.gates.installedCpuCanary = JSON.parse(marker.slice(marker.indexOf('=') + 1));
  const { NodeUninstallScheduler } = await imported('node/uninstall-helper.js');
  const scheduler = new NodeUninstallScheduler(config.uninstall.manifestPath, join(data, 'State/uninstall-requests'));
  const receipt = await scheduler.schedule({ nodeId: config.nodeId, generation: ownership.generation,
    commandId: randomUUID(), retain: { cache: false, logs: false, configuration: false, identity: false } });
  await scheduler.arm(receipt.requestId, receipt.requestDigest);
  await waitFor('uninstall product removal', async () => await access(product).then(() => false, () => true));
  await assert.rejects(command('/bin/launchctl', ['print', service]));
  const pairingAppRemoved = await access('/Applications/Mycellios Pairing.app').then(() => false, () => true);
  const packageReceiptRemoved = await command('/usr/sbin/pkgutil', ['--pkg-info', 'io.mycellios.node']).then(() => false, () => true);
  report.gates.uninstall = { productRemoved: true, serviceRemoved: true, pairingAppRemoved, packageReceiptRemoved };
  assert.equal(pairingAppRemoved, true, 'uninstall left the installed Pairing app');
  assert.equal(packageReceiptRemoved, true, 'uninstall left the installed PKG receipt');
  report.complete = true;
} catch (error) {
  report.error = error.stack ?? String(error);
  report.failureHealth = await load(healthFile).catch(() => null);
  report.failureDiagnostics = await load(join(data, 'Configuration/state/diagnostics.json')).catch(() => null);
  throw error;
}
finally {
  await rm(join(evidence, 'ephemeral-enrollment.json'), { force: true });
  await save();
  if (installed && !report.complete) await command('/bin/launchctl', ['bootout', service]).catch(() => {});
  if (coordinator) await coordinator.close();
}
