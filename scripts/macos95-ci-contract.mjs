import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ABI = 'mycellios-distribution-runtime/4';
export async function verifyCiInstalledLayout(product, expectedSourceId) {
  const layout = JSON.parse(await readFile(join(product, 'layout-manifest.json'), 'utf8'));
  assert.equal(layout.schema, 'mycellios-node-installer-layout/2');
  assert.equal(layout.target, 'macos-arm64');
  assert.equal(layout.source.sourceId, expectedSourceId);
  assert.equal(layout.source.version, '0.2.95');
  for (const path of ['bin/node', 'runtime/bin/python3', 'app/node/install-main.js',
    'app/node/uninstall-main.js', 'python/distributed_runtime/installed_stage_canary.py']) {
    assert.ok(layout.files.some((entry) => entry.path === path), 'missing layout entry: ' + path);
  }
  for (const path of ['app/mycellios-native-build-provenance.json', 'runtime/runtime-manifest.json',
    'app/update/runtime-compatibility.js', 'python/distributed_runtime/installed_stage_canary.py']) {
    const bytes = await readFile(join(product, path));
    const entry = layout.files.find((entry) => entry.path === path);
    assert.equal(bytes.length, entry.bytes, path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, path);
    if (path === 'app/mycellios-native-build-provenance.json') {
      assert.equal(entry.sha256, layout.source.provenanceSha256);
      assert.equal(JSON.parse(bytes).sourceId, expectedSourceId);
    }
    if (path === 'runtime/runtime-manifest.json') {
      const runtime = JSON.parse(bytes);
      assert.equal(runtime.schema, ABI); assert.equal(runtime.platform, 'darwin');
      assert.equal(runtime.arch, 'arm64'); assert.equal(runtime.executable, 'bin/python3');
    }
  }
  return { target: layout.target, sourceId: expectedSourceId,
    provenanceSha256: layout.source.provenanceSha256, sourceFilesAndRuntimeManifestVerified: true };
}
export function contributionCommand(nodeId, generation, type, now = Date.now()) {
  if (!['pause', 'resume'].includes(type)) throw Error('unsupported_ci_command');
  return { schema: 'mycellios-node-command/1', id: randomUUID(), nodeId,
    actor: { kind: 'account', id: 'ci-macos95', scopes: ['node:control'] }, generation,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 120_000).toISOString(),
    nonce: randomUUID().replaceAll('-', ''), type, payload: { version: 1 } };
}

export async function verifyCiContracts(payload) {
  const source = async (path) => await import(pathToFileURL(join(resolve(payload), 'dist', path)));
  const { MYCELLIOS_RUNTIME_ABI } = await source('update/runtime-compatibility.js');
  assert.equal(MYCELLIOS_RUNTIME_ABI, ABI);
  const { defaultNodeInstallationManifest } = await source('node/default-installation.js');
  const manifest = defaultNodeInstallationManifest({ platform: 'darwin' });
  const product = '/Library/Application Support/Mycellios/Product';
  assert.equal(manifest.installRoot, product);
  assert.equal(manifest.nodeExecutable, product + '/bin/node');
  assert.equal(manifest.helperEntrypoint, product + '/app/node/uninstall-main.js');
  assert.equal(manifest.configPath, '/Library/Application Support/Mycellios/Configuration/node.json');
  assert.equal(manifest.identityPath, '/Library/Application Support/Mycellios/Identity/node.json');
  assert.equal(manifest.statePath, '/Library/Application Support/Mycellios/State');
  assert.equal(manifest.serviceDefinitionPath, '/Library/LaunchDaemons/io.mycellios.node.plist');
  assert.equal(manifest.serviceName, 'io.mycellios.node');
  const { NodeUninstallScheduler } = await source('node/uninstall-helper.js');
  assert.equal(typeof NodeUninstallScheduler.prototype.schedule, 'function');
  assert.equal(typeof NodeUninstallScheduler.prototype.arm, 'function');
  const contracts = await source('contracts/node-control.js');
  for (const type of ['pause', 'resume']) {
    const command = contributionCommand('node-' + '1'.repeat(32), 1, type);
    assert.deepEqual(contracts.nodeCommandSchema.parse(command), command);
    assert.throws(() => contracts.nodeCommandSchema.parse({ ...command, generation: 0 }));
  }
  contracts.nodeEnrollmentBundleSchema.parse({ schema: 'mycellios-node-enrollment-bundle/1',
    coordinatorUrl: 'http://127.0.0.1:18791/', enrollmentId: randomUUID(),
    enrollmentToken: 't'.repeat(43), nonce: 'n'.repeat(32), expiresAt: new Date(Date.now() + 120_000).toISOString() });
  return { abi: ABI, defaultMacPaths: true, uninstallMethods: true, pauseResumeSchemas: true, invalidGenerationRejected: true, localEnrollmentSchema: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  console.log(JSON.stringify(await verifyCiContracts(process.argv[2])));
}
