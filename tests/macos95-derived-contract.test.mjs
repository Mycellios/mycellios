import assert from 'node:assert/strict';
import { readFile, lstat, mkdtemp, rm } from 'node:fs/promises';
import { posix, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
const payload = resolve(process.env.MACOS95_DERIVED_PAYLOAD ?? 'runtime/macos95-derived-payload');
const identity = await import(pathToFileURL(join(payload, 'dist/node/identity-store.js')));
const executor = await readFile(join(payload, 'dist/node/uninstall-executor.js'), 'utf8');
const helpers = executor.slice(executor.indexOf('async function validateMacPairingApplication('), executor.indexOf('async function disableService('));
const helperJs = helpers;
const constants = { O_RDONLY: 0, O_NOFOLLOW: 0x100 }; // Darwin fixture; never open a host path.
const dirname = posix.dirname;
function filesystem(options = {}) {
  const calls = [];
  const directory = { isDirectory: () => true, isSymbolicLink: () => false };
  const context = vm.createContext({ Buffer, constants, process, Error,
    lstat: async (path) => {
      calls.push(['lstat', path]);
      if (options.absent && path.endsWith('.app')) throw Object.assign(Error(), { code: 'ENOENT' });
      return { ...directory, isSymbolicLink: () => path === options.symlink };
    },
    open: async (path, flags) => {
      calls.push(['open', path]); assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW);
      const value = path.endsWith('Info.plist') ? '<string>io.mycellios.pairing</string>'
        : '/Library/Application Support/Mycellios/Product/app/node/macos-pairing-main.js';
      return { stat: async () => ({ isFile: () => true, size: options.oversize ? 8193 : value.length }),
        read: async (buffer) => ({ bytesRead: buffer.write(options.mismatch ? 'foreign' : value) }), close: async () => {} };
    },
    execFile: (_file, _args, _options, callback) => callback(options.receiptError ?? null, options.receiptOutput ?? '', ''),
  });
  vm.runInContext(helperJs, context);
  return { context, calls };
}
test('Mac generic password arguments are positional and set verifies actual readback without secret argv', async () => {
  let stored = null; const calls = [];
  const store = new identity.MacOsKeychainSecretStore(async (file, args, stdin) => {
    calls.push({ file, args, stdin });
    if (args[0] === '-i') { stored = 'fixture-secret'; return { code: 0, stdout: '' }; }
    if (args[0] === 'delete-generic-password') { stored = null; return { code: 0, stdout: '' }; }
    return { code: stored ? 0 : 44, stdout: stored ? stored + '\n' : '' };
  });
  assert.equal(await store.get('fixture-ref'), null);
  await store.set('fixture-ref', 'fixture-secret');
  assert.equal(calls.at(-1).args.at(-1), '/Library/Keychains/System.keychain');
  assert.ok(!calls.flatMap((call) => call.args).join(' ').includes('fixture-secret'));
  const stdin = calls.find((call) => call.stdin)?.stdin;
  assert.ok(stdin.endsWith("'/Library/Keychains/System.keychain'\n"));
  assert.ok(!stdin.includes('\nquit\n'));
  await store.delete('fixture-ref');
  assert.equal(await store.get('fixture-ref'), null);
});
test('interactive exit zero without storage is rejected', async () => {
  const store = new identity.MacOsKeychainSecretStore(async (_file, args) => ({ code: args[0] === '-i' ? 0 : 44, stdout: '' }));
  await assert.rejects(store.set('fixture-ref', 'missing'), /keychain_store_failed/);
});
test('real NodeIdentityStore metadata binds uninstall request nodeId before deleting any key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac95-nodeid-'));
  try {
    const file = join(root, 'node.json');
    await new identity.NodeIdentityStore(file, { provider: 'macos-keychain', set: async () => {}, get: async () => null, delete: async () => {} }).loadOrCreate('node-ci-bound');
    const metadata = JSON.parse(await readFile(file, 'utf8')); let calls = 0;
    const run = async (_file, args) => { calls++; assert.ok(args.includes(metadata.secretReference)); return { code: 0, stdout: '' }; };
    await assert.rejects(identity.deleteMacOsNodeIdentity(file, 'foreign-node', run), /identity_mismatch/);
    assert.equal(calls, 0);
    await identity.deleteMacOsNodeIdentity(file, 'node-ci-bound', run);
    assert.equal(calls, 1); assert.equal(metadata.identityId, 'node-ci-bound');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('absent Pairing app is idempotent; recognized app validates', async () => {
  const missing = filesystem({ absent: true });
  assert.equal(await missing.context.validateMacPairingApplication('unused'), false);
  assert.equal(missing.calls.length, 1);
  assert.equal(await filesystem().context.validateMacPairingApplication('/Library/Application Support/Mycellios/Product'), true);
});
test('interior symlink, oversize and foreign content reject before removals', async () => {
  const linked = filesystem({ symlink: '/Applications/Mycellios Pairing.app/Contents' });
  await assert.rejects(linked.context.validateMacPairingApplication('unused'), /pairing_unsafe/);
  assert.ok(!linked.calls.some(([kind]) => kind === 'open'));
  await assert.rejects(filesystem({ oversize: true }).context.validateMacPairingApplication('unused'), /file_unsafe/);
  await assert.rejects(filesystem({ mismatch: true }).context.validateMacPairingApplication('unused'), /pairing_mismatch/);
});
test('receipt absence is narrow; permission and other pkgutil failures remain errors', async () => {
  assert.equal(await filesystem().context.macPackageReceiptPresent(), true);
  assert.equal(await filesystem({ receiptError: { code: 1 }, receiptOutput: "No receipt for 'io.mycellios.node' found at '/'.\n" }).context.macPackageReceiptPresent(), false);
  await assert.rejects(filesystem({ receiptError: { code: 1 }, receiptOutput: 'permission denied' }).context.macPackageReceiptPresent(), /receipt_query_failed/);
});
const uninstallJs = executor.slice(executor.indexOf('export async function executeVerifiedUninstall('), executor.indexOf('async function validateMacPairingApplication(')).replace('export async', 'async');
const macManifest = { platform: 'darwin', serviceName: 'io.mycellios.node',
  installRoot: '/Library/Application Support/Mycellios/Product',
  configPath: '/Library/Application Support/Mycellios/Configuration/node.json',
  identityPath: '/Library/Application Support/Mycellios/Identity/node.json',
  statePath: '/Library/Application Support/Mycellios/State', logsPath: '/Library/Logs/Mycellios',
  cachePath: '/Library/Caches/io.mycellios.node', receiptPath: '/Library/Application Support/Mycellios/Receipts/uninstall.json',
  serviceDefinitionPath: '/Library/LaunchDaemons/io.mycellios.node.plist' };
async function uninstallFixture({ forgetError = false, manifest = macManifest } = {}) {
  const events = [];
  const context = vm.createContext({ Error, Date, Set, Object, dirname,
    readReceipt: async () => null, validateMacPairingApplication: async () => { events.push('validate'); return true; },
    macPackageReceiptPresent: async () => { events.push('query'); return true; },
    disableService: async () => { events.push('stop'); }, deleteMacOsNodeIdentity: async () => { events.push('key'); },
    nodeUninstallReceiptSchema: { parse: (value) => value }, writeReceipt: async () => { events.push('receipt'); },
  });
  vm.runInContext(uninstallJs, context);
  const result = context.executeVerifiedUninstall({ manifest, requestDigest: 'fixture',
    request: { id: 'request', nodeId: 'node-ci-bound', retain: { cache: false, logs: false, identity: false, configuration: false } },
    run: async (_file, args) => { events.push(args[0]); if (forgetError) throw Error('forget_failed'); },
    remove: async (path) => { events.push('remove:' + path); } });
  return { result, events };
}
test('Mac cleanup validates and queries before stopping; forget failure preserves identity and all data', async () => {
  const failed = await uninstallFixture({ forgetError: true });
  await assert.rejects(failed.result, /forget_failed/);
  assert.deepEqual(failed.events, ['validate', 'query', 'stop', '--forget']);
  const success = await uninstallFixture(); await success.result;
  assert.ok(success.events.indexOf('--forget') < success.events.indexOf('key'));
  assert.ok(success.events.includes('remove:/Library/Application Support/Mycellios/Configuration'));
  assert.ok(success.events.includes('remove:/Library/Application Support/Mycellios/Identity'));
});
test('default Mac package refuses mismatching data paths before any external action', async () => {
  const mismatch = await uninstallFixture({ manifest: { ...macManifest, configPath: '/foreign/node.json' } });
  await assert.rejects(mismatch.result, /data_paths_mismatch/);
  assert.deepEqual(mismatch.events, []);
});
test('Darwin registration uses the system chown executable without a Linux or Windows command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mac95-registration-'));
  try {
    const { registerNativeNodeService } = await import(pathToFileURL(join(payload, 'dist/node/service-registration.js')));
    const commands = [];
    await registerNativeNodeService({
      manifest: { ...macManifest, serviceDefinitionPath: join(root, 'service.plist'),
        helperEntrypoint: join(root, 'app/node/uninstall-main.js'), nodeExecutable: '/fixture/node',
        configPath: join(root, 'Configuration/node.json'), identityPath: join(root, 'Identity/node.json'),
        cachePath: join(root, 'Cache'), logsPath: join(root, 'Logs'), statePath: join(root, 'State') },
      config: { isolation: { mode: 'macos-launchd-limits' }, limits: { maxRamMiB: 512 } },
      run: async (file, args) => {
        if (file === '/usr/sbin/chown') for (const path of args.slice(2)) {
          assert.ok(path.startsWith(root));
          const entry = await lstat(path); assert.ok(entry.isDirectory() && !entry.isSymbolicLink());
        }
        commands.push([file, args]); return { code: 0, stdout: '' };
      },
    });
    assert.equal(commands[0][0], '/usr/sbin/chown');
    assert.ok(commands.slice(1).every(([file]) => file === '/bin/launchctl'));
    assert.ok(!commands.some(([file]) => ['/bin/chown', '/usr/bin/chown', 'sc.exe', '/usr/sbin/useradd'].includes(file)));
  } finally { await rm(root, { recursive: true, force: true }); }
});
