import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Execute the original95 store unchanged. Only its fixed keychain location is
// redirected by the supported command-runner seam to an exclusive temporary file.
const [payload, evidence] = process.argv.slice(2).map((value) => resolve(value));
const report = { schema: 'mycellios-macos95-keychain-probe/1',
  temporaryKeychainOnly: true, originalProductSourceUnmodified: true, complete: false, operations: [] };
let root, keychain;
async function run(file, args, stdin) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill(); reject(Error('keychain_probe_command_timeout')); }, 30_000);
    child.stdout.on('data', (chunk) => { bytes += chunk.length; if (bytes > 65_536) child.kill(); else chunks.push(chunk); });
    child.stderr.resume();
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => { clearTimeout(timer); resolveRun({ code: code ?? -1, stdout: Buffer.concat(chunks).toString('utf8') }); });
    child.stdin.end(stdin ?? '');
  });
}
try {
  assert.equal(process.platform, 'darwin');
  root = await mkdtemp(join(tmpdir(), 'mycellios95-keychain-'));
  keychain = join(root, 'fixture.keychain-db');
  const password = randomUUID();
  const created = await run('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
  assert.equal(created.code, 0, 'temporary keychain creation failed');
  assert.equal((await run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain])).code, 0);
  const { MacOsKeychainSecretStore } = await import(pathToFileURL(join(payload, 'dist/node/identity-store.js')));
  const store = new MacOsKeychainSecretStore(async (file, args, stdin) => {
    assert.equal(file, '/usr/bin/security');
    const result = await run(file, args.map((arg) => arg.replaceAll('/Library/Keychains/System.keychain', keychain)),
      stdin?.replaceAll('/Library/Keychains/System.keychain', keychain));
    report.operations.push({ operation: args[0], code: result.code });
    return result;
  });
  const reference = 'macos95-ci-' + randomUUID();
  assert.equal(await store.get(reference), null);
  const value = randomUUID();
  await store.set(reference, value);
  assert.equal(await store.get(reference), value);
  await store.delete(reference);
  assert.equal(await store.get(reference), null);
  report.complete = true;
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  if (keychain) report.temporaryKeychainDeleteCode = (await run('/usr/bin/security', ['delete-keychain', keychain])).code;
  if (root) await rm(root, { recursive: true, force: true });
  await writeFile(join(evidence, 'keychain-probe.json'), JSON.stringify(report, null, 2) + '\n');
}
