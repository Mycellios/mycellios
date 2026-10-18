import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { operate, renameObjectExclusive } from './operator-store.mjs';

// CI runs this disposable fixture as root inside one private Linux mount namespace.
// No production directory, key, network API, package upload or global release mutation.
assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0);
const api = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const base = path.resolve('runtime/macos-supplement-ci');
const sandbox = await fs.mkdtemp(path.join(base, 'operator-fixtures-'));
const root = path.join(sandbox, 'published'); await fs.mkdir(root, { mode: 0o755 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = object => Buffer.from(JSON.stringify(object, null, 2) + '\n');
const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v !== null && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
let checks = 0, mounted = false;
const check = () => checks++;
try {
  const parent = { releaseId: 'sha256:' + 'd'.repeat(64), sourceId: 'sha256:' + 'b'.repeat(64), revision: 'e'.repeat(40), version: '0.2.95', assets: [{ channel: 'downloads', fileName: 'mycellios-node-0.2.95-windows-x64.msi', fileSha256: 'f'.repeat(64) }, { channel: 'downloads', fileName: 'mycellios-node-0.2.95-source.zip', fileSha256: '0'.repeat(64) }] };
  const parentBytes = json(parent), parentFile = path.join(sandbox, 'parent.json'); await fs.writeFile(parentFile, parentBytes, { flag: 'wx', mode: 0o444 });
  async function candidate(label) {
    const dir = path.join(sandbox, label); await fs.mkdir(dir);
    const artifact = Buffer.from('Toy PKG bytes ' + label + '; not a macOS installer');
    const sourceDoc = { schema: 'mycellios-native-build-provenance/1', version: '0.2.95', files: [{ path: 'src/mac-fixture.ts', bytes: 1, sha256: 'a'.repeat(64) }] };
    const source = { ...sourceDoc, sourceId: 'sha256:' + sha(canonical(sourceDoc)) };
    const release = { schema: 'mycellios-node-release-evidence/1', artifact: { name: 'mycellios-node-0.2.95-macos-arm64.pkg', format: 'pkg', target: 'macos-arm64', bytes: artifact.length, sha256: sha(artifact) }, source: { sourceId: source.sourceId, version: '0.2.95' }, builder: { runId: '12345', runAttempt: '1' } };
    const validation = { schema: 'mycellios-macos-supplement-validation/1', sourceId: source.sourceId, artifactSha256: sha(artifact), workflowRunId: '12345', recipeGitRevision: 'c'.repeat(40), verified: true };
    const manifest = { schema: 'mycellios-macos-supplement/1', parent: { releaseId: parent.releaseId, sourceId: parent.sourceId, revision: parent.revision, version: parent.version, windowsFileName: parent.assets[0].fileName, windowsSha256: parent.assets[0].fileSha256 }, target: 'macos-arm64', artifact: { fileName: release.artifact.name, bytes: artifact.length, sha256: sha(artifact) }, build: { sourceId: source.sourceId, baseSourceId: parent.sourceId, baseArchiveSha256: parent.assets[1].fileSha256, patchSha256: '1'.repeat(64), recipeGitRevision: validation.recipeGitRevision, workflowRunId: '12345', workflowRunAttempt: 1, sourceEvidenceSha256: sha(json(source)), releaseEvidenceSha256: sha(json(release)), validationReceiptSha256: sha(json(validation)), signature: 'unsigned' } };
    const manifestBytes = json(manifest), manifestSha = sha(manifestBytes);
    for (const [name, bytes] of [['manifest.json', manifestBytes], ['source.json', json(source)], ['release.json', json(release)], ['validation.json', json(validation)], ['artifact.pkg', artifact]]) await fs.writeFile(path.join(dir, name), bytes, { flag: 'wx', mode: 0o444 });
    return { dir, manifest, manifestSha, artifact };
  }
  const first = await candidate('first'), second = await candidate('second');
  const makePlan = (value, expected, operation = 'publish') => json({ schema: 'mycellios-macos-supplement-operator/1', operation, root, inputDirectory: value.dir, parentManifestPath: parentFile, parentManifestSha256: sha(parentBytes), manifestSha256: value.manifestSha, expectedPointerSha256: expected });
  const run = (bytes, apply = false) => operate(bytes, sha(bytes), api, apply);
  const initial = makePlan(first, 'absent');
  assert.equal((await run(initial)).dryRun, true); assert.deepEqual(await fs.readdir(root), []); check();
  await assert.rejects(operate(initial, '0'.repeat(64), api, true)); check();
  const bad = await candidate('tampered'); await fs.chmod(path.join(bad.dir, 'artifact.pkg'), 0o644); await fs.writeFile(path.join(bad.dir, 'artifact.pkg'), Buffer.alloc(bad.artifact.length, 65));
  await assert.rejects(run(makePlan(bad, 'absent'), true)); assert.deepEqual(await fs.readdir(root), []); check();
  const installed = await run(initial, true); assert(installed.objectCreated && installed.pointerChanged && !installed.globalParentChanged); check();
  let pointerBytes = await fs.readFile(path.join(root, 'pointer.json'));
  await assert.rejects(run(makePlan(second, '0'.repeat(64)), true)); assert((await fs.readFile(path.join(root, 'pointer.json'))).equals(pointerBytes)); check();
  await assert.rejects(run(makePlan(first, sha(pointerBytes)), true)); assert((await fs.readFile(path.join(root, 'pointer.json'))).equals(pointerBytes)); check();
  const crashed = await candidate('crashed'); let verificationCalls = 0;
  const crashApi = { ...api, verifyMacSupplementEvidence(...args) { verificationCalls++; if (verificationCalls === 2) throw new Error('Simulated interruption before final rename'); return api.verifyMacSupplementEvidence(...args); } };
  const crashPlan = makePlan(crashed, sha(pointerBytes));
  await assert.rejects(operate(crashPlan, sha(crashPlan), crashApi, true), /Simulated interruption/);
  await assert.rejects(fs.lstat(path.join(root, 'objects', crashed.manifestSha)), e => e.code === 'ENOENT');
  assert((await fs.readdir(path.join(root, 'objects'))).some(name => name.startsWith('.staging-')));
  assert((await fs.readFile(path.join(root, 'pointer.json'))).equals(pointerBytes)); check();
  const renameFrom = path.join(sandbox, 'rename-from'), renameTo = path.join(sandbox, 'empty-existing-target');
  await fs.mkdir(renameFrom); await fs.writeFile(path.join(renameFrom, 'marker'), 'preserve'); await fs.mkdir(renameTo);
  assert.throws(() => renameObjectExclusive(renameFrom, renameTo));
  assert.equal(await fs.readFile(path.join(renameFrom, 'marker'), 'utf8'), 'preserve'); assert.deepEqual(await fs.readdir(renameTo), []); check();
  assert((await run(makePlan(second, sha(pointerBytes)), true)).objectCreated); check();
  pointerBytes = await fs.readFile(path.join(root, 'pointer.json'));
  assert((await run(makePlan(first, sha(pointerBytes), 'rollback'), true)).pointerChanged); check();
  for (const value of [first, second]) assert((await fs.readFile(path.join(root, 'objects', value.manifestSha, 'artifact.pkg'))).equals(value.artifact)); check();
  assert((await fs.readFile(parentFile)).equals(parentBytes)); check();
  execFileSync('mount', ['--bind', root, root]); mounted = true;
  execFileSync('mount', ['-o', 'remount,bind,ro', root]);
  const real = new api.MacReleaseSupplement({ root, manifestSha256s: [first.manifestSha] }); // No dependency or owner override.
  assert.equal(await real.assetPath(parent, 'downloads', first.manifest.artifact.fileName), path.join(root, 'objects', first.manifestSha, 'artifact.pkg')); check();
  await assert.rejects(fs.writeFile(path.join(root, 'cannot-write'), 'x'), error => error.code === 'EROFS'); check();
  assert.equal(await real.assetPath(parent, 'downloads', parent.assets[0].fileName), null); check();
  const receipt = { schema: 'mycellios-macos-operator-fixtures/1', checks, publishAndRollback: true, defaultDryRun: true, externallyPinnedPlan: true, noObjectOverwrite: true, atomicRenameNoReplace: true, existingEmptyTargetPreserved: true, crashLeavesOnlyPrivateTmp: true, pointerCompareAndSwap: true, parentBytesUnchanged: true, fullDefaultStoreOnRealReadOnlyMount: true, ownerUid: 0, dependencyOverrides: false, packageFixture: true, installerValidated: false, productionChanged: false };
  await fs.writeFile(path.join(base, 'operator-fixtures-proof.json'), json(receipt), { flag: 'wx' });
  console.log(JSON.stringify(receipt));
} finally {
  if (mounted) execFileSync('umount', [root]);
  assert(sandbox.startsWith(base + path.sep + 'operator-fixtures-'));
  await fs.rm(sandbox, { recursive: true });
}
