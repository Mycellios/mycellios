import {stageContributionComponent} from './contribution-component.mjs';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {writeStandaloneInstallerConfig} from './standalone-installer-config.mjs';
import {compactResourceLayout} from './compact-resource-layout.mjs';

// electron-builder concatenates resource arrays from package.json and API
// options. Load one complete file instead, preserving base settings (voice
// unpacking, platform defaults) while replacing the Windows resource layout.
export async function writeStandaloneWindowsConfig(desktopRoot, overrides, output) {
  return writeStandaloneInstallerConfig(desktopRoot,overrides,output,'windows-installer-config.json');
}

/** The pinned agent-desktop CLI must match the digest its locked package publishes beside it. */
export async function verifyAppControlBinary(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('App control binary must be a regular file');
  const expected = (await readFile(file + '.sha256', 'utf8')).trim().split(/s+/)[0];
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (!/^[a-f0-9]{64}$/.test(expected) || hash.digest('hex') !== expected) throw new Error('App control binary hash mismatch');
  return { from: path.resolve(file), to: 'app-control/' + path.basename(file) };
}

export async function prepareWindowsInstaller({ desktopRoot, runtimeMsi, runtimeSha256, output, version, development, compact, buildIdentity, separateRuntime=false, appControlBinary }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Desktop version');
  if (!/^[a-f0-9]{64}$/.test(runtimeSha256)) throw new Error('A pinned runtime hash is required');
  const info = await lstat(runtimeMsi);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Runtime payload must be a regular MSI');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(runtimeMsi)) hash.update(chunk);
  if (hash.digest('hex') !== runtimeSha256) throw new Error('Runtime payload hash mismatch');
  await mkdir(output, { recursive: true });
  let manifest = path.join(output, 'runtime.json');
  await writeFile(manifest, JSON.stringify({ schema: 'mycellios-desktop-runtime/1', file: 'mycellios-runtime.msi', sha256: runtimeSha256 }, null, 2));
  if(separateRuntime)manifest=await stageContributionComponent({file:runtimeMsi,sha256:runtimeSha256,output,extension:'msi'});
  const agentRoot = path.resolve(desktopRoot, '../..');
  const appControl = appControlBinary ? await verifyAppControlBinary(appControlBinary) : undefined;
  const repository = path.resolve(agentRoot, '../..');
  return {
    beforePack: path.join(desktopRoot, 'scripts/verify-release.cjs'),
    ...(compact ? { afterPack: path.join(desktopRoot, 'scripts/verify-windows-zip32.cjs') } : {}),
    appId: 'com.mycellios.agent.desktop',
    productName: 'Mycellios Desktop',
    artifactName: 'Mycellios-Desktop-' + version + '-windows-x64-pilot.${ext}',
    directories: { output: path.resolve(output), buildResources: path.join(desktopRoot, 'assets') },
    files: ['dist/**/*', '!dist/**/*.map', 'package.json'],
    extraMetadata: { name: 'mycellios-desktop', version, main: 'dist/main.js' },
    extraResources: [
      ...(buildIdentity ? [{ from: buildIdentity, to: 'desktop-build.json' }] : []),
      // Koffi 3 uses a platform optional package. Dependency collection can miss
      // it; its loader also supports this explicit unpacked resources location.
      { from: path.join(agentRoot, 'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'), to: 'koffi/win32_x64/koffi.node' },
      ...(compact ? compactResourceLayout(compact) : [
        { from: path.join(desktopRoot, 'local-server'), to: 'local-server', filter: ['**/*', '!node_modules{,/**/*}'] },
        { from: path.join(desktopRoot, 'local-server/node_modules'), to: 'local-server/node_modules', filter: ['**/*', '!**/.bin{,/**/*}'] },
        ...(development ? [{from:development.source,to:'development-source'}, {from:development.npm,to:'development-tools/npm'}] : []),
      ]),
      { from: path.join(repository, 'LICENSE'), to: 'licenses/Mycellios-PolyForm-Shield-1.0.0.txt' },
      { from: path.join(agentRoot, 'LICENSE'), to: 'licenses/Agent-upstream-Apache-2.0.txt' },
      { from: path.join(repository, 'THIRD_PARTY.md'), to: 'licenses/THIRD_PARTY.md' },
      ...(appControl ? [appControl] : []),
      ...(!separateRuntime ? [{ from: path.resolve(runtimeMsi), to: 'contribution/mycellios-runtime.msi' }] : []),
      { from: manifest, to: 'contribution/runtime.json' },
      { from: path.join(desktopRoot, 'scripts/install-runtime.ps1'), to: 'contribution/install-runtime.ps1' },
      { from: path.join(desktopRoot, 'scripts/describe-runtime.ps1'), to: 'contribution/describe-runtime.ps1' },
      { from: path.join(desktopRoot, 'scripts/runtime-public-status.cjs'), to: 'contribution/runtime-public-status.cjs' },
      { from: path.join(desktopRoot, '../web/dist'), to: 'web', filter: ['**/*', '!**/*.map'] },
      { from: path.join(desktopRoot, '../../infra/compose/docker-compose.images.yml'), to: 'stack/docker-compose.images.yml' },
      { from: path.join(desktopRoot, '../../infra/compose/stack-env.example'), to: 'stack/stack-env.example' },
    ],
    // Manual previews must not discover an ambient signing identity or depend on
    // a certificate service. Keep executable resource/icon editing enabled.
    forceCodeSigning: false,
    win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(desktopRoot, 'assets/icon.ico'), verifyUpdateCodeSignature: true, signExecutable: false },
    // The legacy loose tree exceeds ZIP32's entry limit. Compact ASAR resources
    // use bounded ZIP32/Deflate to reduce install-time decompression; afterPack
    // checks the actual payload before nsisunz receives it. Never emit ZIP64.
    // An assisted first install and an explicit Finish/Open action, as upstream.
    // Updates still use /S and our confirmed same-profile relaunch. Keep the
    // installation directory fixed until alternate paths have recovery coverage.
    nsis: { include:path.join(desktopRoot,'assets/fast-install.nsh'),useZip: Boolean(compact),
      // Differential-aware archive generation forces 7z even with useZip=true.
      // Retain the standalone installer blockmap separately after packaging.
      ...(compact ? { differentialPackage: false } : {}), oneClick: false,
      allowToChangeInstallationDirectory: false, allowElevation: false, runAfterFinish: true,
      perMachine: false, deleteAppDataOnUninstall: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Mycellios', uninstallDisplayName: 'Mycellios' },
    // This only writes standard updater metadata/block maps at build time.
    // The unsigned preview still installs through an explicit user action.
    publish: [{ provider: 'generic', url: 'https://www.mycellios.com/downloads/desktop/updates/windows' }],
  };
}

