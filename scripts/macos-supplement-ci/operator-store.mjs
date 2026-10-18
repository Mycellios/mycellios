import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, rename, rmdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha = value => createHash('sha256').update(value).digest('hex');
const pin = /^[a-f0-9]{64}$/;
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const identity = s => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink, s.mode, s.uid].join(':');
async function regular(file, maximum) {
  let ancestor = path.dirname(file);
  for (;;) { const s = await lstat(ancestor); assert(s.isDirectory() && !s.isSymbolicLink(), 'Linked input ancestor'); const parent = path.dirname(ancestor); if (parent === ancestor) break; ancestor = parent; }
  const before = await lstat(file, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(maximum));
  return before;
}
async function bounded(file, maximum, expected) {
  const before = await regular(file, maximum), handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.equal(identity(await handle.stat({ bigint: true })), identity(before));
    const buffer = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < buffer.length) { const part = await handle.read(buffer, count, buffer.length - count, count); if (!part.bytesRead) break; count += part.bytesRead; }
    assert.equal(count, Number(before.size)); assert(count <= maximum);
    assert.equal(identity(await handle.stat({ bigint: true })), identity(before));
    assert.equal(identity(await lstat(file, { bigint: true })), identity(before));
    const bytes = buffer.subarray(0, count); if (expected) assert.equal(sha(bytes), expected);
    return bytes;
  } finally { await handle.close(); }
}
async function syncDirectory(dir) { const h = await open(dir, constants.O_RDONLY); try { await h.sync(); } finally { await h.close(); } }
async function writeExclusive(file, bytes) { const h = await open(file, 'wx', 0o600); try { await h.writeFile(bytes); await h.sync(); await h.chmod(0o444); } finally { await h.close(); } }
async function rootDirectory(root) {
  assert.equal(process.platform, 'linux'); assert.equal(process.getuid(), 0, 'Apply requires root; root ownership alone does not prove read-only serving');
  assert(path.isAbsolute(root) && path.resolve(root) === root);
  let current = root;
  for (;;) { const s = await lstat(current); assert(s.isDirectory() && !s.isSymbolicLink()); if (current === root) assert(s.uid === 0 && (s.mode & 0o022) === 0); const parent = path.dirname(current); if (parent === current) break; current = parent; }
}
async function pointer(root) {
  try { const bytes = await bounded(path.join(root, 'pointer.json'), 4096); return { bytes, sha256: sha(bytes) }; }
  catch (error) { if (error.code === 'ENOENT') return { bytes: null, sha256: 'absent' }; throw error; }
}
async function verifyPayload(source, manifest, destination) {
  const before = await regular(source, 1_500_000_000);
  assert.equal(Number(before.size), manifest.artifact.bytes);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const output = destination ? await open(destination, 'wx', 0o600) : null;
  try {
    assert.equal(identity(await input.stat({ bigint: true })), identity(before));
    let count = 0; const digest = createHash('sha256');
    for await (const part of input.createReadStream({ autoClose: false })) { count += part.length; assert(count <= manifest.artifact.bytes); digest.update(part); if (output) await output.writeFile(part); }
    assert.equal(count, manifest.artifact.bytes); assert.equal(digest.digest('hex'), manifest.artifact.sha256);
    assert.equal(identity(await input.stat({ bigint: true })), identity(before));
    assert.equal(identity(await lstat(source, { bigint: true })), identity(before));
    if (output) { await output.sync(); await output.chmod(0o444); }
  } finally { await output?.close(); await input.close(); }
}

/** Trusted operator plan, externally hash-approved. Dry run never writes the root. */
export async function operate(planBytes, expectedPlanSha256, api, apply = false) {
  assert(pin.test(expectedPlanSha256)); assert.equal(sha(planBytes), expectedPlanSha256);
  const plan = api.parseStrictJson(planBytes.toString('utf8'));
  assert.equal(plan.schema, 'mycellios-macos-supplement-operator/1');
  assert(['publish', 'rollback'].includes(plan.operation));
  assert(pin.test(plan.manifestSha256));
  assert(pin.test(plan.parentManifestSha256));
  assert(plan.expectedPointerSha256 === 'absent' || pin.test(plan.expectedPointerSha256));
  assert(path.isAbsolute(plan.root) && path.resolve(plan.root) === plan.root);
  const parentBytes = await bounded(plan.parentManifestPath, 65536, plan.parentManifestSha256);
  const parent = api.parseStrictJson(parentBytes.toString('utf8'));
  const object = path.join(plan.root, 'objects', plan.manifestSha256);
  const sourceRoot = plan.operation === 'publish' ? plan.inputDirectory : object;
  assert(path.isAbsolute(sourceRoot) && path.resolve(sourceRoot) === sourceRoot);
  const manifestBytes = await bounded(path.join(sourceRoot, 'manifest.json'), 32768, plan.manifestSha256);
  const manifest = api.parseMacSupplementManifest(api.parseStrictJson(manifestBytes.toString('utf8')));
  const entries = await Promise.all([
    ['source.json', 262144, manifest.build.sourceEvidenceSha256],
    ['release.json', 65536, manifest.build.releaseEvidenceSha256],
    ['validation.json', 65536, manifest.build.validationReceiptSha256],
  ].map(async ([name, limit, hash]) => ({ name, bytes: await bounded(path.join(sourceRoot, name), limit, hash) })));
  api.verifyMacSupplementEvidence(manifest, ...entries.map(row => api.parseStrictJson(row.bytes.toString('utf8'))));
  assert.equal(parent.releaseId, manifest.parent.releaseId); assert.equal(parent.sourceId, manifest.parent.sourceId); assert.equal(parent.revision, manifest.parent.revision); assert.equal(parent.version, manifest.parent.version);
  assert(parent.assets.some(a => a.channel === 'downloads' && a.fileName === manifest.parent.windowsFileName && a.fileSha256 === manifest.parent.windowsSha256));
  assert(parent.assets.some(a => a.channel === 'downloads' && a.fileName === `mycellios-node-${parent.version}-source.zip` && a.fileSha256 === manifest.build.baseArchiveSha256));
  await verifyPayload(path.join(sourceRoot, 'artifact.pkg'), manifest);
  const before = await pointer(plan.root); assert.equal(before.sha256, plan.expectedPointerSha256, 'Pointer CAS mismatch');
  const receipt = { schema: 'mycellios-macos-supplement-operator-result/1', operation: plan.operation, planSha256: expectedPlanSha256, manifestSha256: plan.manifestSha256, previousPointerSha256: before.sha256, dryRun: !apply, objectCreated: false, pointerChanged: false, globalParentChanged: false, servingReadOnlyMountCertified: false };
  if (!apply) return receipt;
  await rootDirectory(plan.root);
  const lock = path.join(plan.root, '.publisher-lock');
  await mkdir(lock, { mode: 0o700 }); // No stale-lock removal: a crashed publisher requires operator review.
  try {
    assert.equal((await pointer(plan.root)).sha256, plan.expectedPointerSha256, 'Pointer changed before lock');
    if (plan.operation === 'publish') {
      const objects = path.join(plan.root, 'objects');
      try { await mkdir(objects, { mode: 0o755 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      const objectsStat = await lstat(objects); assert(objectsStat.isDirectory() && !objectsStat.isSymbolicLink() && objectsStat.uid === 0 && (objectsStat.mode & 0o022) === 0);
      await mkdir(object, { mode: 0o700 }); // Exclusive, never replace even an incomplete previous object.
      await writeExclusive(path.join(object, 'manifest.json'), manifestBytes);
      for (const entry of entries) await writeExclusive(path.join(object, entry.name), entry.bytes);
      await verifyPayload(path.join(sourceRoot, 'artifact.pkg'), manifest, path.join(object, 'artifact.pkg'));
      await chmod(object, 0o555); await syncDirectory(object); await syncDirectory(objects);
      receipt.objectCreated = true;
    }
    const objectStat = await lstat(object), objectsStat = await lstat(path.dirname(object));
    for (const stat of [objectStat, objectsStat]) assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o022) === 0);
    for (const name of ['manifest.json', 'source.json', 'release.json', 'validation.json', 'artifact.pkg']) {
      const s = await lstat(path.join(object, name)); assert(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.uid === 0 && (s.mode & 0o022) === 0);
    }
    const candidatePointer = json({ schema: 'mycellios-macos-supplement-pointer/1', manifestSha256: plan.manifestSha256 });
    // Copying authenticates every byte before chmod/fsync; serving additionally requires a real read-only mount.
    const history = path.join(plan.root, 'pointer-history');
    try { await mkdir(history, { mode: 0o755 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const hs = await lstat(history); assert(hs.isDirectory() && !hs.isSymbolicLink() && hs.uid === 0 && (hs.mode & 0o022) === 0);
    if (before.bytes) { const old = path.join(history, before.sha256 + '.json'); try { await writeExclusive(old, before.bytes); } catch (e) { if (e.code !== 'EEXIST') throw e; assert((await bounded(old, 4096, before.sha256)).equals(before.bytes)); } await syncDirectory(history); }
    const pending = path.join(plan.root, 'pointer-' + randomUUID() + '.pending');
    await writeExclusive(pending, candidatePointer);
    assert.equal((await pointer(plan.root)).sha256, plan.expectedPointerSha256, 'Pointer changed under exclusive publisher lock');
    await rename(pending, path.join(plan.root, 'pointer.json')); await syncDirectory(plan.root);
    receipt.pointerChanged = true; receipt.pointerSha256 = sha(candidatePointer);
    return receipt;
  } finally { await rmdir(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--') && a.includes('=')).map(a => { const at = a.indexOf('='); return [a.slice(2, at), a.slice(at + 1)]; }));
  assert(args.plan && pin.test(args['plan-sha256']) && args.module && pin.test(args['module-sha256']));
  const moduleBytes = await bounded(path.resolve(args.module), 262144, args['module-sha256']); void moduleBytes;
  const api = await import(pathToFileURL(path.resolve(args.module)).href);
  const result = await operate(await bounded(path.resolve(args.plan), 32768), args['plan-sha256'], api, process.argv.includes('--apply'));
  console.log(JSON.stringify(result));
}
