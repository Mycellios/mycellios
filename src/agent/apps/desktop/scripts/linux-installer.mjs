import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Linux x64 pilot; the same hosted frontend and existing headless service, no second engine. */
export async function prepareLinuxInstaller({ desktopRoot, runtimeDeb, runtimeSha256, output, version, development }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Desktop version');
  if (!/^[a-f0-9]{64}$/.test(runtimeSha256)) throw new Error('A pinned runtime hash is required');
  const info = await lstat(runtimeDeb);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Runtime payload must be a regular DEB');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(runtimeDeb)) hash.update(chunk);
  if (hash.digest('hex') !== runtimeSha256) throw new Error('Runtime payload hash mismatch');
  await mkdir(output, { recursive: true });
  const manifest = path.join(output, 'runtime.json');
  if (process.platform === 'linux') {
    for (const file of ['install-runtime.sh', 'describe-runtime.sh']) await chmod(path.join(desktopRoot, 'scripts', file), 0o755);
  }
  await writeFile(manifest, JSON.stringify({ schema: 'mycellios-desktop-runtime/1', file: 'mycellios-runtime.deb', sha256: runtimeSha256 }, null, 2));
  const agentRoot = path.resolve(desktopRoot, '../..');
  const repository = path.resolve(agentRoot, '../..');
  return {
    beforePack: path.join(desktopRoot, 'scripts/verify-release.cjs'),
    appId: 'com.mycellios.agent.desktop', productName: 'Mycellios Desktop',
    artifactName: 'Mycellios-Desktop-' + version + '-linux-x64-pilot.${ext}',
    directories: { output: path.resolve(output), buildResources: path.join(desktopRoot, 'assets') },
    files: ['dist/**/*', '!dist/**/*.map', 'package.json'],
    extraMetadata: { name: 'mycellios-desktop', version, main: 'dist/main.js', homepage: 'https://www.mycellios.com', desktopName: 'mycellios-desktop.desktop' },
    extraResources: [
      { from: path.join(desktopRoot, 'local-server'), to: 'local-server', filter: ['**/*', '!node_modules{,/**/*}'] },
      { from: path.join(desktopRoot, 'local-server/node_modules'), to: 'local-server/node_modules', filter: ['**/*', '!**/.bin{,/**/*}'] },
      ...(development ? [{from:development.source,to:'development-source'}, {from:development.npm,to:'development-tools/npm'}] : []),
      { from: path.resolve(runtimeDeb), to: 'contribution/mycellios-runtime.deb' },
      { from: manifest, to: 'contribution/runtime.json' },
      { from: path.join(desktopRoot, 'scripts/install-runtime.sh'), to: 'contribution/install-runtime.sh' },
      { from: path.join(desktopRoot, 'scripts/describe-runtime.sh'), to: 'contribution/describe-runtime.sh' },
      { from: path.join(desktopRoot, 'scripts/runtime-public-status.cjs'), to: 'contribution/runtime-public-status.cjs' },
      { from: path.join(desktopRoot, '../web/dist'), to: 'web', filter: ['**/*', '!**/*.map'] },
      { from: path.join(agentRoot, 'infra/compose/docker-compose.images.yml'), to: 'stack/docker-compose.images.yml' },
      { from: path.join(agentRoot, 'infra/compose/stack-env.example'), to: 'stack/stack-env.example' },
      { from: path.join(repository, 'LICENSE'), to: 'licenses/Mycellios-GPL-3.0.txt' },
      { from: path.join(agentRoot, 'LICENSE'), to: 'licenses/Agent-upstream-Apache-2.0.txt' },
      { from: path.join(repository, 'THIRD_PARTY.md'), to: 'licenses/THIRD_PARTY.md' },
    ],
    linux: { target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }], executableName: 'mycellios-desktop', syncDesktopName: true, icon: path.join(desktopRoot, 'assets/icon.png'), category: 'Utility', maintainer: 'Mycellios <support@mycellios.com>' },
    deb: { compression: 'gz', depends: ['libgtk-3-0 | libgtk-3-0t64', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils', 'libatspi2.0-0', 'libuuid1', 'libasound2 | libasound2t64', 'libgbm1', 'libsecret-1-0', 'systemd', 'policykit-1', 'shared-mime-info'] },
    appImage: { compression: 'gzip' },
    publish: [],
  };
}

