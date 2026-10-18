import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
const [payload, evidence] = process.argv.slice(2).map((value) => resolve(value));
assert.equal(process.platform, 'darwin');
const source = JSON.parse(await readFile(join(payload, 'mycellios-native-build-provenance.json'), 'utf8'));
const linuxOnly = new Map([
  ...['/usr/sbin/useradd', '/usr/sbin/nologin', '/bin/chown', '/bin/systemctl']
    .map((path) => [path, 'src/node/service-registration.ts']),
  ['/usr/bin/mycellios', 'scripts/verify-installer-package-tree.mjs'],
]);
const observed = new Map();
for (const row of source.files) {
  if (!/\.(?:ts|py|mjs|sh)$/.test(row.path)) continue;
  const text = await readFile(join(payload, row.path), 'utf8');
  for (const match of text.matchAll(/["'](\/(?:usr\/)?s?bin\/[^\s"'`]+)["']/g)) {
    const paths = observed.get(match[1]) ?? [];
    paths.push(row.path); observed.set(match[1], paths);
  }
}
const rows = [];
for (const [path, files] of [...observed].sort(([a], [b]) => a.localeCompare(b))) {
  if (linuxOnly.has(path)) {
    assert.ok(files.every((file) => file === linuxOnly.get(path)));
    rows.push({ path, files, scope: 'Linux branch only; not executed or required on Mac' });
  } else {
    await access(path, constants.X_OK);
    rows.push({ path, files, executableOnActualRunner: true });
  }
}
const command = promisify(execFile);
const pathCommands = [];
for (const name of ['launchctl', 'system_profiler', 'pkgbuild', 'pkgutil', 'tar']) {
  const { stdout } = await command('/usr/bin/which', [name], { timeout: 10_000 });
  const path = stdout.trim(); assert.ok(path.startsWith('/'));
  await access(path, constants.X_OK); pathCommands.push({ name, path });
}
for (const path of ['/usr/sbin/chown', '/bin/launchctl', '/usr/bin/security', '/usr/bin/osascript',
  '/usr/sbin/pkgutil', '/usr/sbin/installer', '/bin/ps', '/sbin/route']) await access(path, constants.X_OK);
await writeFile(join(evidence, 'mac-executable-audit.json'), JSON.stringify({
  schema: 'mycellios-macos95-executable-audit/1', payloadSourceId: source.sourceId,
  sourceRecordsInspected: source.files.length, mutatingCommandsExecuted: false,
  systemExecutableLiterals: rows, pathCommands,
  installedDataPaths: 'Validated against actual PKG layout and default-installation contract in installer canary.' }, null, 2) + '\n');
